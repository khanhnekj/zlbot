import fs from "node:fs";
import path from "node:path";
import axios from "axios";
import { spawn, execSync } from "node:child_process";
import FormData from "form-data";
import { log } from "../logger.js";

function resolveFFmpeg() {
    try { return execSync("which ffmpeg", { encoding: "utf8" }).trim(); } catch {}
    return "ffmpeg";
}
const ffmpegPath = resolveFFmpeg();

export const name = "stk";
export const version = "2.5.0";
export const credits = "V Tuấn & Gemini";
export const description = "Tạo sticker từ ảnh/GIF, xóa nền ảnh. Hỗ trợ reply và đính kèm trực tiếp";

const BOT_NAME = "LauNa";

async function uploadToCatbox(filePath) {
    try {
        if (!fs.existsSync(filePath)) return null;
        const form = new FormData();
        form.append("reqtype", "fileupload");
        form.append("fileToUpload", fs.createReadStream(filePath));

        const response = await axios.post("https://catbox.moe/user/api.php", form, {
            headers: form.getHeaders(),
            timeout: 30000
        });

        const url = typeof response.data === "string" ? response.data.trim() : null;
        return url && url.startsWith("http") ? url : null;
    } catch (e) {
        log.error(`Lỗi Catbox: ${e.message}`);
        return null;
    }
}

async function downloadWithRetry(mediaUrl, dest, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const response = await axios.get(mediaUrl, {
                responseType: "arraybuffer",
                headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
                timeout: 25000
            });
            fs.writeFileSync(dest, Buffer.from(response.data));
            return true;
        } catch (e) {
            if (attempt === retries) throw e;
            await new Promise(r => setTimeout(r, 1000 * attempt));
        }
    }
}

async function convertToWebp(mediaUrl, uniqueId) {
    const tempDir = path.join(process.cwd(), "src/modules/cache/stk_temp");
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const tIn = path.join(tempDir, `in_${uniqueId}`);
    const tOut = path.join(tempDir, `out_${uniqueId}.webp`);

    try {
        await downloadWithRetry(mediaUrl, tIn);

        if (!fs.existsSync(tIn) || fs.statSync(tIn).size < 100) return null;

        const cmdArgs = [
            "-y",
            "-i", tIn,
            "-vf", "scale='if(gt(iw,ih),min(iw,512),-1)':'if(gt(iw,ih),-1,min(ih,512))'",
            "-c:v", "libwebp",
            "-lossless", "0",
            "-compression_level", "4",
            "-q:v", "75",
            "-loop", "0",
            "-an",
            "-vsync", "0",
            tOut
        ];

        await new Promise((resolve, reject) => {
            const ffmpeg = spawn(ffmpegPath, cmdArgs);
            ffmpeg.on("close", (code) => {
                if (code === 0) resolve();
                else reject(new Error(`ffmpeg exited with code ${code}`));
            });
            ffmpeg.on("error", reject);
        });

        if (fs.existsSync(tOut) && fs.statSync(tOut).size > 0) {
            return tOut;
        }
        return null;
    } catch (e) {
        log.error(`Lỗi Convert: ${e.message}`);
        return null;
    } finally {
        if (fs.existsSync(tIn)) try { fs.unlinkSync(tIn); } catch { }
    }
}

export async function convertAndSendSticker(api, mediaUrl, threadId, threadType, senderId) {
    const uniqueId = `${senderId}_${Date.now()}`;
    const webpPath = await convertToWebp(mediaUrl, uniqueId);

    if (!webpPath) return false;

    try {
        const webpUrl = await uploadToCatbox(webpPath);
        if (!webpUrl) return false;

        await api.sendCustomSticker({
            animationImgUrl: webpUrl,
            staticImgUrl: webpUrl,
            threadId,
            type: threadType,
            width: 512,
            height: 512
        });
        return true;
    } finally {
        if (fs.existsSync(webpPath)) try { fs.unlinkSync(webpPath); } catch { }
    }
}

function extractMediaUrlFromAttach(attachData) {
    if (!attachData) return null;
    let data = attachData;
    if (typeof data === "string") {
        try { data = JSON.parse(data); } catch { return null; }
    }
    const url = data.hdUrl || data.url || data.href || data.thumbUrl;
    if (!url) return null;
    const final = Array.isArray(url) ? url[0] : url;
    return decodeURIComponent(String(final).replace(/\\\//g, "/"));
}

function extractMediaUrlFromMessage(message) {
    const raw = message?.data || {};

    const attachments = raw.attachments || [];
    for (const att of attachments) {
        const url = att?.hdUrl || att?.fileUrl || att?.url || att?.href;
        if (url && /\.(jpg|jpeg|png|gif|webp)/i.test(url)) {
            return decodeURIComponent(String(url).replace(/\\\//g, "/"));
        }
    }

    const msgAttach = raw.msgAttach || raw.attach;
    if (msgAttach) {
        const url = extractMediaUrlFromAttach(msgAttach);
        if (url) return url;
    }

    return null;
}

// ─── XÓA NỀN via @imgly/background-removal-node (local ONNX) ─────────────────

let _rmbgLib = null;
async function getRmbgLib() {
    if (!_rmbgLib) {
        const mod = await import("@imgly/background-removal-node");
        _rmbgLib = mod.removeBackground;
    }
    return _rmbgLib;
}

async function removeBackground(imgBuf) {
    const removeBackgroundFn = await getRmbgLib();
    const tempIn = path.join(process.cwd(), "src/modules/cache/stk_temp", `rmbg_in_${Date.now()}.jpg`);
    const tempDir = path.dirname(tempIn);
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(tempIn, imgBuf);
    try {
        const result = await removeBackgroundFn(tempIn);
        return Buffer.from(await result.arrayBuffer());
    } finally {
        try { fs.unlinkSync(tempIn); } catch {}
    }
}

async function convertPngToWebpSticker(pngPath, uniqueId) {
    const tempDir = path.dirname(pngPath);
    const outPath = path.join(tempDir, `stk_xn_${uniqueId}.webp`);

    const cmdArgs = [
        "-y", "-i", pngPath,
        "-vf", "scale='if(gt(iw,ih),min(iw,512),-1)':'if(gt(iw,ih),-1,min(ih,512))'",
        "-c:v", "libwebp",
        "-lossless", "0",
        "-compression_level", "4",
        "-q:v", "75",
        "-loop", "0",
        "-an", "-vsync", "0",
        outPath
    ];

    await new Promise((resolve, reject) => {
        const ff = spawn(ffmpegPath, cmdArgs);
        ff.on("close", code => code === 0 ? resolve() : reject(new Error(`ffmpeg code ${code}`)));
        ff.on("error", reject);
    });

    return fs.existsSync(outPath) && fs.statSync(outPath).size > 0 ? outPath : null;
}

async function getMediaUrl(message) {
    const raw = message?.data || {};
    let url = extractMediaUrlFromMessage(message);
    if (!url && raw.quote?.attach) url = extractMediaUrlFromAttach(raw.quote.attach);
    return url;
}

async function xoaNenHandler(ctx, makeSticker = false) {
    const { api, threadId, threadType, message, senderId, senderName } = ctx;
    const tag = `@${senderName} `;

    const mediaUrl = await getMediaUrl(message);
    if (!mediaUrl) {
        return api.sendMessage(
            { msg: `➜ 💡 ${BOT_NAME}: Reply vào ảnh hoặc đính kèm ảnh để tớ xóa nền nhé!` },
            threadId, threadType
        );
    }

    const action = makeSticker ? "Đang xóa nền + tạo sticker" : "Đang xóa nền ảnh";
    await api.sendMessage({
        msg: tag + `${BOT_NAME}: ${action}, chờ xíu nha~ ✨`,
        mentions: [{ uid: senderId, pos: 0, len: tag.length }]
    }, threadId, threadType);

    const tempDir = path.join(process.cwd(), "src/modules/cache/stk_temp");
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const ts = Date.now();
    const pngPath = path.join(tempDir, `rmbg_${ts}.png`);
    let webpPath = null;

    try {
        const imgRes = await axios.get(mediaUrl, {
            responseType: "arraybuffer",
            headers: { "User-Agent": "Mozilla/5.0" },
            timeout: 25000,
        });
        const resultBuf = await removeBackground(Buffer.from(imgRes.data));
        fs.writeFileSync(pngPath, resultBuf);

        if (makeSticker) {
            // Xóa nền → WebP sticker → Catbox → gửi sticker
            webpPath = await convertPngToWebpSticker(pngPath, ts);
            if (!webpPath) throw new Error("Chuyển đổi WebP thất bại.");

            const webpUrl = await uploadToCatbox(webpPath);
            if (!webpUrl) throw new Error("Upload Catbox thất bại.");

            await api.sendCustomSticker({
                animationImgUrl: webpUrl,
                staticImgUrl: webpUrl,
                threadId,
                type: threadType,
                width: 512,
                height: 512
            });
        } else {
            // Chỉ xóa nền → gửi PNG
            await api.sendMessage(
                { msg: `✅ ${BOT_NAME}: Xóa nền xong!`, attachments: [pngPath] },
                threadId, threadType
            );
        }
    } catch (e) {
        log.error(`Lỗi XóaNền: ${e.message}`);
        await api.sendMessage(
            { msg: `➜ ❌ ${BOT_NAME}: Xóa nền lỗi rồi! ${e.message}` },
            threadId, threadType
        );
    } finally {
        try { if (fs.existsSync(pngPath)) fs.unlinkSync(pngPath); } catch {}
        try { if (webpPath && fs.existsSync(webpPath)) fs.unlinkSync(webpPath); } catch {}
    }
}

async function stkHandler(ctx) {
    const { api, threadId, threadType, message, senderId, senderName } = ctx;
    const raw = message?.data || {};
    const quote = raw.quote;

    if (!quote || !quote.attach) {
        return api.sendMessage(
            { msg: `➜ 💡 ${BOT_NAME}: Hãy reply vào ảnh hoặc GIF để tớ làm sticker nhé!` },
            threadId, threadType
        );
    }

    const tag = `@${senderName} `;
    try {
        const mediaUrl = extractMediaUrlFromAttach(quote.attach);
        if (!mediaUrl) {
            return api.sendMessage(
                { msg: `➜ ❌ ${BOT_NAME}: Hông lấy được link ảnh rồi. Cậu thử lại với ảnh khác nhé!` },
                threadId, threadType
            );
        }

        await api.sendMessage({
            msg: tag + `${BOT_NAME}: Đang làm sticker cho cậu, chờ xíu nha~ ✨`,
            mentions: [{ uid: senderId, pos: 0, len: tag.length }]
        }, threadId, threadType);

        const ok = await convertAndSendSticker(api, mediaUrl, threadId, threadType, senderId, senderName);
        if (!ok) {
            api.sendMessage(
                { msg: `➜ ❌ ${BOT_NAME}: Làm sticker lỗi rồi! Có thể do ảnh không đúng định dạng đó.` },
                threadId, threadType
            );
        }
    } catch (e) {
        log.error(`Lỗi STK: ${e.message}`);
        api.sendMessage(
            { msg: `➜ ❌ ${BOT_NAME}: Lỗi hệ thống: ${e.message}` },
            threadId, threadType
        );
    }
}

async function taostkHandler(ctx) {
    const { api, threadId, threadType, message, senderId, senderName } = ctx;
    const tag = `@${senderName} `;

    const mediaUrl = extractMediaUrlFromMessage(message);

    if (!mediaUrl) {
        const raw = message?.data || {};
        const quote = raw.quote;
        if (quote?.attach) {
            return stkHandler(ctx);
        }
        return api.sendMessage(
            { msg: `➜ 💡 ${BOT_NAME}: Cậu đính kèm ảnh/GIF vào tin nhắn hoặc reply vào ảnh để tớ tạo sticker nhé!` },
            threadId, threadType
        );
    }

    try {
        await api.sendMessage({
            msg: tag + `${BOT_NAME}: Đang tạo sticker từ ảnh cậu gửi, chờ xíu nha~ ✨`,
            mentions: [{ uid: senderId, pos: 0, len: tag.length }]
        }, threadId, threadType);

        const ok = await convertAndSendSticker(api, mediaUrl, threadId, threadType, senderId, senderName);
        if (!ok) {
            api.sendMessage(
                { msg: `➜ ❌ ${BOT_NAME}: Không tạo được sticker. Cậu thử ảnh khác xem sao nha!` },
                threadId, threadType
            );
        }
    } catch (e) {
        log.error(`Lỗi TAOSTK: ${e.message}`);
        api.sendMessage(
            { msg: `➜ ❌ ${BOT_NAME}: Lỗi: ${e.message}` },
            threadId, threadType
        );
    }
}

export const commands = {
    stk: async (ctx) => {
        const sub = (ctx.args?.[0] || "").toLowerCase();
        if (sub === "xn" || sub === "xoanen") return xoaNenHandler(ctx, true);
        await stkHandler(ctx);
    },
    taostk: async (ctx) => {
        await taostkHandler(ctx);
    },
    xoanen: async (ctx) => {
        await xoaNenHandler(ctx, false);
    },
    xn: async (ctx) => {
        await xoaNenHandler(ctx, false);
    },
};
