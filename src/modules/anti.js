import { log, axios, fs, path } from "../globals.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import https from "node:https";
import http from "node:http";
import { spawn, execSync } from "node:child_process";

export const name = "anti-protections";
export const description = "Bảo vệ nhóm: Link, Spam, Photo, Sticker, Tag, Nude + lệnh bật/tắt";
export const alwaysRun = true;

// ─── Regex ───────────────────────────────────────────────────────────────────

const ZALO_GROUP_LINK_REGEX = /zalo\.me\/g\/[a-zA-Z0-9_\-]+/i;
const STICKER_URL_REGEX = /zfcloud\.zdn\.vn.*StickerBy|sticker.*\.webp/i;
const PHOTO_URL_REGEX = /https?:\/\/[^\s]+(\.jpg|\.jpeg|\.png|\.webp|\.gif)(\?[^\s]*)?/i;
const ZALO_PHOTO_URL_REGEX = /https?:\/\/(photo|cover|thumb|avatar|zalo)[^\s]*\.(zdn\.vn|cloudfront\.net|zadn\.vn)[^\s]*/i;
// Regex tìm tất cả URL ảnh/video trong văn bản (dùng cho anti-nude link check)
const ALL_HTTP_URL_REGEX = /https?:\/\/[^\s<>"']+/gi;
const IMAGE_LINK_EXT_REGEX = /\.(jpg|jpeg|png|webp|gif|bmp|avif)(\?[^\s]*)?$/i;

// ─── NSFW Backend ─────────────────────────────────────────────────────────────

const NSFW_THRESHOLD = 0.55;
let _nsfwBackend = null;
let _nsfwModel = null;

function getAntiNudeConfig() {
    try {
        const cfg = JSON.parse(readFileSync(join(process.cwd(), "tokens.json"), "utf-8"));
        return cfg.antinude || {};
    } catch { return {}; }
}

async function initNsfwBackend() {
    if (_nsfwBackend !== null) return _nsfwBackend;
    const cfg = getAntiNudeConfig();

    // Ưu tiên 1: Falconsai (HuggingFace) — cùng model với safe-content-ai
    if (cfg.hf_token) {
        _nsfwBackend = "falconsai";
        return _nsfwBackend;
    }

    // Ưu tiên 2: nsfwjs (TensorFlow local)
    try {
        let tf = null;
        let useNodeTF = false;
        try {
            tf = await import("@tensorflow/tfjs-node");
            useNodeTF = !!(tf.node?.decodeImage);
        } catch {
            try {
                tf = await import("@tensorflow/tfjs");
                try { await import("@tensorflow/tfjs-backend-cpu"); } catch { }
                await tf.setBackend("cpu");
            } catch { tf = null; }
        }
        if (tf) {
            const nsfwjs = await import("nsfwjs");
            _nsfwModel = { tf, nsfwjs: nsfwjs.default || nsfwjs, useNodeTF };
            const _warn = console.warn; const _log = console.log;
            console.warn = () => {}; console.log = () => {};
            const model = await _nsfwModel.nsfwjs.load();
            console.warn = _warn; console.log = _log;
            _nsfwModel.model = model;
            _nsfwBackend = "nsfwjs";
            return _nsfwBackend;
        }
    } catch { }

    // Ưu tiên 3: Sightengine
    if (cfg.sightengine_user && cfg.sightengine_secret) {
        _nsfwBackend = "sightengine";
        return _nsfwBackend;
    }

    // Ưu tiên 4: DeepAI
    if (cfg.deepai_key) {
        _nsfwBackend = "deepai";
        return _nsfwBackend;
    }

    _nsfwBackend = "none";
    return _nsfwBackend;
}

// Convert ảnh bất kỳ format → PNG buffer qua sharp
// Ubuntu/Linux x64 + Node 20: JPEG, PNG, WebP, JXL, GIF, BMP, TIFF, AVIF
// Phát hiện MP4/video qua magic bytes: ftyp box tại offset 4
function _isMp4Buffer(buf) {
    if (!buf || buf.length < 8) return false;
    const ftyp = buf.slice(4, 8).toString("ascii");
    return ftyp === "ftyp" || ftyp === "moov" || ftyp === "mdat";
}

// Nếu URL Zalo là JXL (có /jxl/ hoặc .jxl), thử đổi sang JPG
function _tryJxlToJpgUrl(url) {
    if (!url) return null;
    if (url.includes("/jxl/") || url.endsWith(".jxl")) {
        return url.replace("/jxl/", "/jpg/").replace(/\.jxl(\?.*)?$/, ".jpg$1");
    }
    return null;
}

async function _convertToPng(rawBuf) {
    // Buffer là video MP4 → không phải ảnh
    if (_isMp4Buffer(rawBuf)) {
        throw new Error("URL này trỏ đến video (MP4), không phải ảnh. Bot cần thumbnail để kiểm tra.");
    }

    // Kiểm tra HTML/error response
    const headStr = rawBuf.slice(0, 200).toString("utf8");
    const looksLikeHtml = headStr.startsWith("<!") || headStr.startsWith("<h") || headStr.startsWith("<H");
    if (looksLikeHtml || rawBuf.length < 100) {
        throw new Error("CDN trả về dữ liệu không phải ảnh (URL hết hạn hoặc cần đăng nhập)");
    }

    const sharp = (await import("sharp")).default;
    return sharp(rawBuf).png().toBuffer();
}

// Download ảnh từ Zalo CDN. Nếu URL là JXL → thử JPG trước
async function _downloadMedia(url) {
    const doGet = (u) => axios({
        method: "get", url: u,
        responseType: "arraybuffer",
        timeout: 20000,
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer":    "https://chat.zalo.me/",
            "Accept":     "image/jpeg,image/png,image/webp,image/*,*/*;q=0.8",
        },
    });

    // Thử JPG thay thế trước nếu URL là JXL
    const jpgUrl = _tryJxlToJpgUrl(url);
    if (jpgUrl) {
        try {
            const r = await doGet(jpgUrl);
            const buf = Buffer.from(r.data);
            if (!_isMp4Buffer(buf) && buf.length > 100) return buf;
        } catch {}
    }

    const res = await doGet(url);
    return Buffer.from(res.data);
}

// Detect định dạng ảnh qua magic bytes
function _detectImgFormat(buf) {
    if (!buf || buf.length < 12) return "unknown";
    // JPEG: FF D8
    if (buf[0] === 0xFF && buf[1] === 0xD8) return "jpeg";
    // PNG:  89 50 4E 47
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return "png";
    // GIF:  47 49 46
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "gif";
    // BMP:  42 4D
    if (buf[0] === 0x42 && buf[1] === 0x4D) return "bmp";
    // WebP: RIFF????WEBP
    if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
        buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return "webp";
    // JXL naked codestream: FF 0A
    if (buf[0] === 0xFF && buf[1] === 0x0A) return "jxl";
    // JXL ISOBMFF container: 00 00 00 0C 4A 58 4C 20
    if (buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x00 && buf[3] === 0x0C &&
        buf[4] === 0x4A && buf[5] === 0x58 && buf[6] === 0x4C && buf[7] === 0x20) return "jxl";
    return "unknown";
}

async function checkNsfwViaNsfwjs(mediaUrl) {
    const { model, tf, useNodeTF } = _nsfwModel;

    const cacheDir = path.join(process.cwd(), ".cache");
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

    const NSFW_CLASSES = ["Porn", "Hentai", "Sexy"];

    // 1. Download ảnh
    const rawBuf = await _downloadMedia(mediaUrl);

    // Nếu URL trả về video MP4 thay vì ảnh → trả null để caller biết
    if (_isMp4Buffer(rawBuf)) {
        return null;
    }

    const fmt    = _detectImgFormat(rawBuf);

    // 2. Convert về PNG qua sharp (hỗ trợ mọi format: JXL, WebP, JPEG, PNG...)
    const pngBuf = await _convertToPng(rawBuf);

    // 3. Phân tích với tf.node.decodeImage
    if (useNodeTF && tf.node?.decodeImage) {
        const tensor = tf.node.decodeImage(pngBuf, 3);
        try {
            const predictions = await model.classify(tensor);
            return predictions.filter(p => NSFW_CLASSES.includes(p.className))
                .reduce((s, p) => s + p.probability, 0);
        } finally {
            tensor.dispose();
        }
    }

    // 4. Fallback: canvas (nếu tfjs-node không có)
    const pngPath = path.join(cacheDir, `nsfw_${Date.now()}.png`);
    try {
        fs.writeFileSync(pngPath, pngBuf);
        const { createCanvas, loadImage } = await import("canvas");
        const image  = await loadImage(pngPath);
        const canvas = createCanvas(image.width, image.height);
        canvas.getContext("2d").drawImage(image, 0, 0);
        const predictions = await model.classify(canvas);
        return predictions.filter(p => NSFW_CLASSES.includes(p.className))
            .reduce((s, p) => s + p.probability, 0);
    } finally {
        try { if (fs.existsSync(pngPath)) fs.unlinkSync(pngPath); } catch {}
    }
}

async function checkNsfwViaSightengine(mediaUrl) {
    const cfg = getAntiNudeConfig();
    const res = await axios.get("https://api.sightengine.com/1.0/check.json", {
        params: { url: mediaUrl, models: "nudity-2.1", api_user: cfg.sightengine_user, api_secret: cfg.sightengine_secret },
        timeout: 10000
    });
    const d = res.data;
    if (d.status !== "success") return 0;
    const nudity = d.nudity || {};
    return Math.min((nudity.sexual_display || 0) + (nudity.sexual_activity || 0) + ((nudity.suggestive_classes?.very_revealing || 0) * 0.6), 1);
}

async function checkNsfwViaDeepAI(mediaUrl) {
    const cfg = getAntiNudeConfig();
    const FormData = (await import("form-data")).default;
    const form = new FormData();
    form.append("image", mediaUrl);
    const res = await axios.post("https://api.deepai.org/api/nsfw-detector", form, {
        headers: { ...form.getHeaders(), "api-key": cfg.deepai_key },
        timeout: 15000
    });
    return res.data?.output?.nsfw_score || 0;
}

// ─── Falconsai/nsfw_image_detection qua HuggingFace Inference API ─────────────
// Đây là model chính xác giống safe-content-ai (steelcityamir) nhưng không cần Python server.
// Cài: thêm "hf_token": "hf_xxx" vào antinude trong tokens.json
async function checkNsfwViaFalconsai(mediaUrl) {
    const cfg = getAntiNudeConfig();
    const HF_TOKEN = cfg.hf_token;
    const HF_URL   = "https://api-inference.huggingface.co/models/falconsai/nsfw_image_detection";

    // Tải ảnh về buffer rồi gửi lên HF (tránh lỗi auth khi HF tự fetch từ Zalo CDN)
    const imgBuf = await _downloadMedia(mediaUrl);

    // Nếu URL trả về video MP4 thay vì ảnh → trả null để caller biết
    if (_isMp4Buffer(imgBuf)) {
        return null;
    }

    const res = await axios.post(HF_URL, imgBuf, {
        headers: {
            "Authorization": `Bearer ${HF_TOKEN}`,
            "Content-Type":  "application/octet-stream",
        },
        timeout: 30000,
    });

    // Response: [{"label":"nsfw","score":0.99}, {"label":"normal","score":0.01}]
    const predictions = Array.isArray(res.data) ? res.data : [];
    const nsfw = predictions.find(p => p.label === "nsfw");
    return nsfw ? nsfw.score : 0;
}

async function checkNsfw(mediaUrl) {
    if (!mediaUrl) return false;
    try {
        const score = await checkNsfwViaBackend(mediaUrl);
        if (score === null) return false;
        return score >= NSFW_THRESHOLD;
    } catch {
        return false;
    }
}

// ─── Lấy URL video thực (không phải thumbnail) ────────────────────────────────

function getVideoActualUrl(data) {
    const c      = _parseContentObj(data?.content);
    const attach = _parseContentObj(data?.attach);
    const extras = [c?.extra, attach?.extra, c, attach].filter(Boolean);
    for (const o of extras) {
        const u = o?.videoUrl || o?.href;
        if (u && typeof u === "string") return u;
    }
    return null;
}

// ─── Trích xuất frame ảnh từ video URL bằng ffmpeg ────────────────────────────

let _ffmpegBin = null;
function getFfmpegBin() {
    if (_ffmpegBin) return _ffmpegBin;
    try { _ffmpegBin = execSync("which ffmpeg", { encoding: "utf8" }).trim(); } catch { _ffmpegBin = "ffmpeg"; }
    return _ffmpegBin;
}

async function extractFrameFromVideo(videoUrl) {
    const cacheDir = path.join(process.cwd(), ".cache");
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

    const ts      = Date.now();
    const outPath = path.join(cacheDir, `frame_${ts}.jpg`);
    const ffmpeg  = getFfmpegBin();

    // Chạy ffmpeg với inputSrc cho trước (URL hoặc local path)
    const runFfmpeg = (inputSrc, extraInputArgs = []) => new Promise((resolve, reject) => {
        const args = [
            ...extraInputArgs,
            "-i", inputSrc,
            "-vframes", "1",
            "-f", "image2",
            "-q:v", "2",
            "-y", outPath,
        ];
        const proc  = spawn(ffmpeg, args, { stdio: "ignore" });
        const timer = setTimeout(() => { try { proc.kill(); } catch {} reject(new Error("ffmpeg timeout")); }, 25000);
        proc.on("close", (code) => {
            clearTimeout(timer);
            if (code === 0 && fs.existsSync(outPath)) resolve();
            else reject(new Error(`ffmpeg exit ${code}`));
        });
        proc.on("error", (e) => { clearTimeout(timer); reject(e); });
    });

    // ── Attempt 1: ffmpeg trực tiếp URL với Zalo headers (tốt cho Zalo CDN) ────
    try {
        await runFfmpeg(videoUrl, [
            "-headers", "Referer: https://chat.zalo.me/\r\nUser-Agent: Mozilla/5.0\r\n",
            "-ss", "1",
        ]);
        const buf = fs.readFileSync(outPath);
        try { fs.unlinkSync(outPath); } catch {}
        return buf;
    } catch {
        // Attempt 1 thất bại, thử tải video về local
    }

    // ── Attempt 2: Tải thông minh — xử lý JSON API / redirect / stream ─────────
    const tmpVideo = path.join(cacheDir, `vid_${ts}.tmp`);

    // Helper: stream URL vào file tạm (tối đa maxBytes)
    const streamToFile = async (srcUrl, destPath, maxBytes = 8 * 1024 * 1024) => {
        const r = await axios.get(srcUrl, {
            responseType: "stream",
            timeout: 30000,
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
                "Accept": "video/*,*/*;q=0.8",
                "Referer": (() => { try { return new URL(srcUrl).origin + "/"; } catch { return ""; } })(),
            },
            maxRedirects: 10,
            validateStatus: s => s < 500,
        });
        const ct = (r.headers?.["content-type"] || "").toLowerCase();
        await new Promise((resolve, reject) => {
            const out = fs.createWriteStream(destPath);
            let received = 0;
            r.data.on("data", (chunk) => {
                received += chunk.length;
                out.write(chunk);
                if (received >= maxBytes) { r.data.destroy(); out.end(); }
            });
            r.data.on("end", () => out.end());
            r.data.on("error", (e) => { out.destroy(); reject(e); });
            out.on("finish", resolve);
            out.on("error", reject);
        });
        return ct;
    };

    try {
        // — Bước 1: GET để xem content-type thực sự và resolve URL thật ─────────
        const probeResp = await axios.get(videoUrl, {
            responseType: "arraybuffer",
            timeout: 10000,
            maxContentLength: 300_000, // tối đa 300 KB cho probe
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
                "Accept": "*/*",
            },
            maxRedirects: 10,
            validateStatus: s => s < 500,
        }).catch(e => {
            // maxContentLength exceeded → vẫn OK nếu có partial data
            if (e.response) return e.response;
            throw e;
        });

        const ct2 = (probeResp.headers?.["content-type"] || "").toLowerCase();


        // — Bước 2: Xử lý theo content-type ──────────────────────────────────────
        let realVideoUrl = null;

        if (ct2.startsWith("video/") || ct2.includes("octet-stream")) {
            // Server trả thẳng video bytes → ghi tiếp phần đã tải, rồi stream thêm
            const partial = Buffer.from(probeResp.data || []);
            if (partial.length > 200) {
                fs.writeFileSync(tmpVideo, partial);
                // Thử ffmpeg trên partial buffer ngay (có thể đủ giây đầu)
                try {
                    await runFfmpeg(tmpVideo, ["-ss", "0"]);
                    const buf = fs.readFileSync(outPath);
                    try { fs.unlinkSync(outPath); } catch {}
                    try { fs.unlinkSync(tmpVideo); } catch {}
                    return buf;
                } catch { /* fallthrough → stream đủ */ }
            }
            realVideoUrl = videoUrl;

        } else if (ct2.includes("application/json")) {
            // API trả JSON → parse → tìm URL video trong object
            try {
                const json = JSON.parse(Buffer.from(probeResp.data).toString("utf-8"));
                realVideoUrl = _findVideoUrlInValue(json);
            } catch { /* JSON parse fail */ }

        } else if (ct2.includes("text/html")) {
            // HTML → tìm og:video hoặc <source src=...>
            const html = Buffer.from(probeResp.data).toString("utf-8");
            const ogMatch = html.match(/<meta[^>]+property=["']og:video["'][^>]+content=["']([^"']+\.(?:mp4|mov|m3u8|webm))[^"']*["']/i)
                || html.match(/content=["']([^"']+\.(?:mp4|mov|m3u8|webm))[^"']*["'][^>]+property=["']og:video["']/i)
                || html.match(/<source[^>]+src=["']([^"']+\.(?:mp4|mov|m3u8|webm))[^"']*["']/i);
            if (ogMatch) {
                realVideoUrl = ogMatch[1];
            }
        }

        // — Bước 3: Nếu tìm được URL video thực → download + ffmpeg ─────────────
        if (realVideoUrl) {
            const ctFile = await streamToFile(realVideoUrl, tmpVideo);
            const stat = fs.statSync(tmpVideo);
            if (stat.size < 200) throw new Error(`File tải về quá nhỏ (${stat.size} bytes)`);
            await runFfmpeg(tmpVideo, ["-ss", "1"]);
            const buf = fs.readFileSync(outPath);
            try { fs.unlinkSync(outPath); } catch {}
            try { fs.unlinkSync(tmpVideo); } catch {}
            return buf;
        }

        throw new Error(`Không tìm được URL video trong response (ct=${ct2.slice(0,40)})`);
    } catch (e2) {
        try { fs.unlinkSync(tmpVideo); } catch {}
        try { fs.unlinkSync(outPath); } catch {}
        throw new Error(`Không thể trích frame: ${e2.message}`);
    }
}

// Đệ quy tìm URL video trong JSON object/array
function _findVideoUrlInValue(val, depth = 0) {
    if (depth > 6) return null;
    if (typeof val === "string") {
        if (/^https?:\/\/.+\.(mp4|mov|avi|mkv|webm|m3u8|flv)(\?[^\s]*)?$/i.test(val)) return val;
        return null;
    }
    if (Array.isArray(val)) {
        for (const item of val) {
            const r = _findVideoUrlInValue(item, depth + 1);
            if (r) return r;
        }
    }
    if (val && typeof val === "object") {
        // Thử các key ưu tiên trước
        for (const key of ["url", "videoUrl", "video_url", "src", "source", "link", "stream", "href", "download", "path", "file"]) {
            if (val[key]) {
                const r = _findVideoUrlInValue(val[key], depth + 1);
                if (r) return r;
            }
        }
        // Rồi quét toàn bộ
        for (const v of Object.values(val)) {
            const r = _findVideoUrlInValue(v, depth + 1);
            if (r) return r;
        }
    }
    return null;
}

// ─── Kiểm tra NSFW trực tiếp từ Buffer (dùng sau khi extract video frame) ─────

async function checkNsfwOnBuffer(buf) {
    try {
        const backend = await initNsfwBackend();
        if (backend === "none") return null;

        if (backend === "nsfwjs") {
            const { model, tf, useNodeTF } = _nsfwModel;
            const NSFW_CLASSES = ["Porn", "Hentai", "Sexy"];
            const pngBuf = await _convertToPng(buf);
            if (useNodeTF && tf.node?.decodeImage) {
                const tensor = tf.node.decodeImage(pngBuf, 3);
                try {
                    const predictions = await model.classify(tensor);
                    return predictions.filter(p => NSFW_CLASSES.includes(p.className))
                        .reduce((s, p) => s + p.probability, 0);
                } finally { tensor.dispose(); }
            }
            // canvas fallback
            const cacheDir = path.join(process.cwd(), ".cache");
            const pngPath  = path.join(cacheDir, `nsfw_buf_${Date.now()}.png`);
            try {
                fs.writeFileSync(pngPath, pngBuf);
                const { createCanvas, loadImage } = await import("canvas");
                const image  = await loadImage(pngPath);
                const canvas = createCanvas(image.width, image.height);
                canvas.getContext("2d").drawImage(image, 0, 0);
                const predictions = await model.classify(canvas);
                return predictions.filter(p => NSFW_CLASSES.includes(p.className))
                    .reduce((s, p) => s + p.probability, 0);
            } finally {
                try { if (fs.existsSync(pngPath)) fs.unlinkSync(pngPath); } catch {}
            }
        }

        if (backend === "falconsai") {
            const cfg = getAntiNudeConfig();
            if (!cfg.hf_token) return null;
            const HF_URL = "https://api-inference.huggingface.co/models/falconsai/nsfw_image_detection";
            const res = await axios.post(HF_URL, buf, {
                headers: { "Authorization": `Bearer ${cfg.hf_token}`, "Content-Type": "application/octet-stream" },
                timeout: 30000,
            });
            const predictions = Array.isArray(res.data) ? res.data : [];
            const nsfw = predictions.find(p => p.label === "nsfw");
            return nsfw ? nsfw.score : 0;
        }

        return null; // sightengine/deepai cần URL, không hỗ trợ buffer
    } catch {
        return null;
    }
}

// ─── Kiểm tra NSFW video: thumbnail → nếu MP4 thì extract frame bằng ffmpeg ──

async function checkNsfwVideo(thumbUrl, videoUrl) {
    // 1. Thử thumbnail trước (nếu có và không phải MP4)
    if (thumbUrl) {
        const score = await checkNsfwViaBackend(thumbUrl);
        if (score !== null) return score;
    }
    // 2. Thumbnail là MP4 hoặc không có → extract frame từ video thực
    if (videoUrl) {
        try {
            const frameBuf = await extractFrameFromVideo(videoUrl);
            return await checkNsfwOnBuffer(frameBuf);
        } catch {
            // Không trích được frame
        }
    }
    return null;
}

// ─── Wrapper gọi backend bằng URL (trả null nếu URL là MP4/format lạ) ────────

async function checkNsfwViaBackend(mediaUrl) {
    try {
        const backend = await initNsfwBackend();
        if (backend === "none") return null;
        let score = 0;
        if (backend === "falconsai")        score = await checkNsfwViaFalconsai(mediaUrl);
        else if (backend === "nsfwjs")      score = await checkNsfwViaNsfwjs(mediaUrl);
        else if (backend === "sightengine") score = await checkNsfwViaSightengine(mediaUrl);
        else if (backend === "deepai")      score = await checkNsfwViaDeepAI(mediaUrl);
        return score; // null = URL là MP4, number = điểm NSFW
    } catch {
        return null;
    }
}

// ─── Trích URL ảnh từ văn bản (dùng cho anti-nude link check) ────────────────

function extractImageUrlsFromText(text) {
    if (!text || typeof text !== "string") return [];
    const matches = [];
    let m;
    const re = new RegExp(ALL_HTTP_URL_REGEX.source, "gi");
    while ((m = re.exec(text)) !== null) {
        const url = m[0].replace(/[.,!?)>]+$/, ""); // bỏ dấu câu cuối
        if (IMAGE_LINK_EXT_REGEX.test(url) || ZALO_PHOTO_URL_REGEX.test(url)) {
            matches.push(url);
        }
    }
    return [...new Set(matches)]; // loại trùng
}

// Regex nhanh để nhận dạng URL video theo đuôi file
const VIDEO_LINK_EXT_REGEX = /\.(mp4|mov|avi|mkv|webm|flv|m4v|3gp)(\?[^\s]*)?$/i;

/**
 * Trích toàn bộ URL từ text, trả về mảng { url, hint: "image"|"video"|"unknown" }.
 * Giới hạn tối đa maxUrls phần tử (mặc định 5).
 */
function extractAllUrlsFromText(text, maxUrls = 5) {
    if (!text || typeof text !== "string") return [];
    const seen = new Set();
    const result = [];
    const re = new RegExp(ALL_HTTP_URL_REGEX.source, "gi");
    let m;
    while ((m = re.exec(text)) !== null && result.length < maxUrls) {
        const url = m[0].replace(/[.,!?)>]+$/, "");
        if (seen.has(url)) continue;
        seen.add(url);
        let hint = "unknown";
        if (IMAGE_LINK_EXT_REGEX.test(url) || ZALO_PHOTO_URL_REGEX.test(url)) hint = "image";
        else if (VIDEO_LINK_EXT_REGEX.test(url)) hint = "video";
        result.push({ url, hint });
    }
    return result;
}

/**
 * HEAD request để xác định loại nội dung thực sự (image/video/other).
 * Trả về "image" | "video" | "unknown".
 * Timeout ngắn (4 s) để không làm chậm bot.
 */
async function probeUrlContentType(url) {
    try {
        const resp = await axios.head(url, {
            timeout: 4000,
            maxRedirects: 5,
            validateStatus: s => s < 500,
            headers: { "User-Agent": "Mozilla/5.0" },
        });
        const ct = (resp.headers?.["content-type"] || "").toLowerCase();
        if (ct.startsWith("image/")) return "image";
        if (ct.startsWith("video/") || ct.includes("octet-stream")) return "video";
        return "unknown";
    } catch {
        return "unknown";
    }
}

// ─── Phát hiện loại media ─────────────────────────────────────────────────────

function isSticker(data, content) {
    if (data.stickerId || data.sticker_id) return true;
    if (data.msgType === "chat.sticker" || data.msgType === 36 || data.msgType === "36") return true;
    if (typeof data.msgType === "string" && data.msgType.includes("sticker")) return true;
    if (typeof content === "string" && (content === "[STICKER]" || STICKER_URL_REGEX.test(content))) return true;
    if (data?.content && typeof data.content === "object") {
        const c = data.content;
        if ((c.id || c.stickerId) && (c.catId || c.cateId || c.categoryId)) return true;
    }
    return false;
}

function isVideo(data, content) {
    if (data.type === "video") return true;
    if (data.msgType === "chat.video") return true;
    if (typeof data.msgType === "string" && data.msgType.includes("video")) return true;
    if (typeof content === "string" && /\.(mp4|mov|avi|mkv|webm)(\?|$)/i.test(content)) return true;
    if (data?.content && typeof data.content === "object") {
        const c = data.content;
        // duration tồn tại → video
        if (c.duration !== undefined) return true;
        // Content chứa URL file mp4/mov/mkv
        const urlFields = [c.url, c.hdUrl, c.normalUrl, c.href, c?.extra?.url, c?.extra?.hdUrl];
        for (const u of urlFields) {
            if (typeof u === "string" && /\.(mp4|mov|avi|mkv|webm)(\?|$)/i.test(u)) return true;
        }
    }
    // Kiểm tra các trường attach/media nếu có
    if (data?.attach && typeof data.attach === "object") {
        if (data.attach.duration !== undefined) return true;
    }
    return false;
}

function isPhoto(data, content) {
    if (isSticker(data, content)) return false;
    if (isVideo(data, content)) return false;
    if (data.mediaType === 1 || data.type === "photo"
        || data.msgType === "chat.photo"
        || data.msgType === 2 || data.msgType === "2"
        || data.msgType === 32 || data.msgType === "32") return true;
    if (typeof data.msgType === "string" && data.msgType.includes("photo")) return true;
    if (typeof content === "string" && content.startsWith("http")) {
        if (ZALO_PHOTO_URL_REGEX.test(content) || PHOTO_URL_REGEX.test(content)) return true;
    }
    if (data?.content && typeof data.content === "object") {
        const c = data.content;
        if (c.hdUrl || c.url || c.normalUrl || c.thumbUrl || c?.extra?.hdUrl || c?.extra?.url) return true;
    }
    return false;
}

function getPhotoUrl(data, content) {
    const c = data?.content;
    if (c && typeof c === "object") {
        const extra = c?.extra || {};
        const url = extra?.hdUrl || extra?.url || extra?.normalUrl || extra?.thumbUrl
            || c?.href || c?.hdUrl || c?.url || c?.normalUrl || c?.thumbUrl || null;
        if (url) return url;
    }
    if (typeof c === "string" && c.startsWith("http")) return c;
    if (typeof content === "string" && content.startsWith("http")) return content;
    return null;
}

function _parseContentObj(raw) {
    if (!raw) return null;
    if (typeof raw === "object") return raw;
    if (typeof raw === "string") {
        try { return JSON.parse(raw); } catch { return null; }
    }
    return null;
}

function getVideoThumbnailUrl(data) {
    // Kiểm tra trực tiếp trên object (quote thường có thumbUrl/thumb ở top-level)
    if (data?.thumbUrl) return data.thumbUrl;
    if (data?.thumb)    return data.thumb;

    const c      = _parseContentObj(data?.content);
    const attach = _parseContentObj(data?.attach);
    if (c && typeof c === "object") {
        const extra = c.extra || {};
        const url = extra.thumbUrl || extra.thumb || c.thumbUrl || c.thumb || c.thumbnail || null;
        if (url) return url;
    }
    if (attach && typeof attach === "object") {
        const extra = attach.extra || {};
        const url = extra.thumbUrl || extra.thumb || attach.thumbUrl || attach.thumb || null;
        if (url) return url;
    }
    return null;
}

// Kiểm tra URL có phải Zalo video CDN không
function _isVideoCdnUrl(url) {
    if (!url) return false;
    return url.includes("video-stal") || url.includes("dlmd.me") || /\.(mp4|mov|avi|mkv|webm)(\?|$)/i.test(url);
}

function getStickerIdFromData(data) {
    if (data?.stickerId) return String(data.stickerId);
    if (data?.sticker_id) return String(data.sticker_id);
    const c = _parseContentObj(data?.content);
    if (c) return String(c.id || c.stickerId || c.stickerID || "") || null;
    const a = _parseContentObj(data?.attach);
    if (a) return String(a.id || a.stickerId || a.stickerID || "") || null;
    return null;
}

// ─── Spam tracker ─────────────────────────────────────────────────────────────

const spamData = new Map();
const kickHistoryMap = new Map(); // per-thread: threadId → number[]
const MSG_LIMIT = 7;
const TIME_LIMIT = 5000;
const MAX_KICKS_PER_MIN = 5;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getDisplayName(api, uid) {
    try {
        const info = await api.getUserInfo(uid);
        const u = info?.[uid] || info?.[String(uid)] || info;
        return u?.displayName || u?.zaloName || u?.name || String(uid || "Thành viên");
    } catch { return String(uid || "Thành viên"); }
}

async function kickUser(api, threadId, senderId) {
    await api.removeUserFromGroup(String(threadId), [senderId]);
}

async function handleDeleteAndReport(ctx, type, count) {
    const { api, message, threadId, threadType, senderId } = ctx;
    const config = protectionManager.CONFIG[type];
    try {
        await api.deleteMessage({
            data: { msgId: message.data.msgId || message.data.globalMsgId, cliMsgId: message.data.cliMsgId, uidFrom: senderId },
            threadId, type: threadType
        }, false);
    } catch (e) { log.error(`[Anti-${type}] Lỗi xóa tin:`, e.message); }

    const name = await getDisplayName(api, senderId);
    const headers = {
        photo: "📷 ANTI-PHOTO", video: "🎬 ANTI-VIDEO", sticker: "🎨 ANTI-STICKER",
        tag: "🏷️ ANTI-TAG", link: "🔗 ANTI-LINK", spam: "⚡ ANTI-SPAM", nude: "🔞 ANTI-NUDE"
    };
    const reasons = {
        photo: "không cho gửi ảnh", video: "không cho gửi video", sticker: "không cho gửi sticker",
        tag: "không được tag @Tất cả/spam tag", link: "không được gửi link nhóm Zalo",
        spam: "không cho phép gửi tin nhắn dồn dập", nude: "không cho phép gửi ảnh/video nhạy cảm (18+)"
    };
    const headerLabel = headers[type] || `ANTI-${type.toUpperCase()}`;
    const headerLine = `➜ [ ${headerLabel} ]`;
    const nameStart = headerLine.length + 1;
    let msg = "";
    if (type === "link_del") {
        msg = `➜ [ 🔗 ANTI-LINK ]\n${name}\n➜ 🚫 Link nhóm Zalo hổng có tốt cho nhóm mình đâu. Bé gỡ giúp rồi nhé, đừng gửi nữa nha! 🌸`;
    } else if (config && count >= config.kick) {
        try {
            await kickUser(api, threadId, senderId);
            msg = `${headerLine}\n${name}\n➜ 📣 Đã thẳng tay tiễn bạn rời khỏi nhóm do cố ý vi phạm quá nhiều lần (${count}/${config.kick}). Tạm biệt nhé! 👋`;
            protectionManager.resetViolation(threadId, senderId, type);
        } catch {
            msg = `${headerLine}\n${name}\n➜ ⚠️ Định "kick" bạn rồi nhưng mà bot hổng có đủ quyền nè. Ad ơi xử lý giúp bé với! 🥺`;
            protectionManager.resetViolation(threadId, senderId, type);
        }
    } else if (config && count === config.warn) {
        msg = `${headerLine}\n${name}\n➜ 😡 CẢNH BÁO CUỐI CÙNG! Bạn đã vi phạm ${count} lần rồi đó. Thêm 1 lần nữa là "bay màu" khỏi nhóm luôn nhé! 💣`;
    } else if (config && count === 1) {
        msg = `${headerLine}\n${name}\n➜ 🎀 Nhẹ nhàng nhắc nhở: Nhóm mình ${reasons[type] || "đang có bảo vệ"}. Đừng tái phạm nha, thương lắm nè! ✨`;
    }
    if (msg) {
        await api.sendMessage({
            msg,
            styles: [
                { start: 2, len: headerLabel.length + 4, st: "b" },
                { start: 2, len: headerLabel.length + 4, st: "c_db342e" },
                { start: nameStart, len: name.length, st: "b" }
            ]
        }, threadId, threadType);
    }
}

// ─── Lệnh bật/tắt ────────────────────────────────────────────────────────────

const menuSessions = new Map();

const PROTECTION_TYPES = [
    { id: "1", type: "link",    name: "Anti-Link (Chặn link nhóm)",    emoji: "🔗" },
    { id: "2", type: "spam",    name: "Anti-Spam (Chặn tin dồn dập)",  emoji: "⚡" },
    { id: "3", type: "photo",   name: "Anti-Photo (Chặn gửi ảnh)",     emoji: "📸" },
    { id: "4", type: "sticker", name: "Anti-Sticker (Chặn sticker)",   emoji: "🎨" },
    { id: "5", type: "tag",     name: "Anti-Tag (Chặn tag @all)",       emoji: "🔔" },
    { id: "6", type: "undo",    name: "Anti-Undo (Chống thu hồi tin)", emoji: "🔒" },
    { id: "7", type: "nude",    name: "Anti-Nude (Chặn ảnh 18+)",      emoji: "🔞" }
];

function buildHeaderStyles(header, senderName) {
    const prefixLen = 2;
    const headerLen = header.length;
    const senderStart = prefixLen + headerLen + 1;
    return [
        { start: prefixLen, len: headerLen, st: "b" },
        { start: prefixLen, len: headerLen, st: "c_db342e" },
        { start: senderStart, len: senderName.length, st: "b" }
    ];
}

async function toggleProtection(api, threadId, threadType, senderId, items) {
    const senderName = await getDisplayName(api, senderId);
    const results = [];
    for (const item of items) {
        const nextState = !protectionManager.isEnabled(threadId, item.type);
        protectionManager.setEnabled(threadId, item.type, nextState);
        results.push(`${item.emoji} ${item.name}: ${nextState ? "BẬT ✅" : "TẮT ❌"}`);
    }
    const HEADER = "[ SETTINGS PROTECTION ]";
    const msg = `➜ ${HEADER}\n${senderName}\n─────────────────\n${results.join("\n")}\n─────────────────\n✨ Đã cập nhật trạng thái mới cho bạn nè!`;
    await api.sendMessage({ msg, styles: buildHeaderStyles(HEADER, senderName) }, threadId, threadType);
}

async function handleShortcut(ctx, type) {
    const { api, args, threadId, threadType, senderId, isGroup, adminIds } = ctx;
    if (!isGroup) return api.sendMessage({ msg: "⚠️ Bé chỉ hỗ trợ bảo vệ trong nhóm thôi nha!" }, threadId, threadType);
    const senderName = await getDisplayName(api, senderId);
    if (!adminIds.includes(String(senderId))) {
        return api.sendMessage({
            msg: `${senderName}\n➜ ⚠️ Lệnh này chỉ dành cho Admin Bot hoặc QTV thôi nè! 🌸`,
            styles: [{ start: 0, len: senderName.length, st: "b" }]
        }, threadId, threadType);
    }
    const target = PROTECTION_TYPES.find(p => p.type === type);
    if (!target) return;
    const action = (args[0] || "").toLowerCase();
    let newState;
    if (action === "on") newState = true;
    else if (action === "off") newState = false;
    else newState = !protectionManager.isEnabled(threadId, type);
    protectionManager.setEnabled(threadId, type, newState);
    const stateText = newState ? "BẬT ✅" : "TẮT ❌";
    const HEADER = "[ PROTECTION ]";
    const msg = `➜ ${HEADER}\n${senderName}\n➜ ${target.emoji} ${target.name} đã được ${stateText}! ✨`;
    return api.sendMessage({ msg, styles: buildHeaderStyles(HEADER, senderName) }, threadId, threadType);
}

export const commands = {
    anti: async (ctx) => {
        const { api, args, threadId, threadType, senderId, isGroup, message, adminIds } = ctx;
        if (!isGroup) return api.sendMessage({ msg: "⚠️ Bé chỉ hỗ trợ bảo vệ trong nhóm thôi nha!" }, threadId, threadType);
        const senderName = await getDisplayName(api, senderId);
        if (!adminIds.includes(String(senderId))) {
            return api.sendMessage({
                msg: `${senderName}\n➜ ⚠️ Menu này chỉ dành cho Admin Bot hoặc QTV thôi nè! 🌸`,
                styles: [{ start: 0, len: senderName.length, st: "b" }]
            }, threadId, threadType);
        }
        if (args.length > 0) {
            const firstArg = args[0].toLowerCase();
            const target = PROTECTION_TYPES.find(p => p.type === firstArg || p.id === firstArg);
            if (target) {
                const action = (args[1] || "").toLowerCase();
                const newState = (action === "on") ? true : (action === "off") ? false : !protectionManager.isEnabled(threadId, target.type);
                protectionManager.setEnabled(threadId, target.type, newState);
                const HEADER = "[ PROTECTION ]";
                const msg = `➜ ${HEADER}\n${senderName}\n➜ ${target.emoji} ${target.name} đã được ${newState ? "BẬT ✅" : "TẮT ❌"}! ✨`;
                return api.sendMessage({ msg, styles: buildHeaderStyles(HEADER, senderName) }, threadId, threadType);
            }
        }
        const HEADER = "🛡️ [ SETTINGS PROTECTION ]";
        let help = `➜ ${HEADER}\n${senderName}\n─────────────────\n`;
        PROTECTION_TYPES.forEach(p => {
            const status = protectionManager.isEnabled(threadId, p.type) ? "ON ✅" : "OFF ❌";
            help += `${p.id}. ${p.emoji} ${p.name} [${status}]\n`;
        });
        help += `─────────────────\n💡 Reply số (ví dụ: 1 hoặc 137) để bật/tắt nhanh các tính năng nhé! 🎀`;
        await api.sendMessage({
            msg: help,
            quote: message?.data,
            styles: [
                { start: 2, len: HEADER.length, st: "b" },
                { start: 2, len: HEADER.length, st: "c_db342e" },
                { start: 2 + HEADER.length + 1, len: senderName.length, st: "b" }
            ]
        }, threadId, threadType);
        const key = `${threadId}_${senderId}`;
        const sessionTime = Date.now();
        menuSessions.set(key, { time: sessionTime });
        setTimeout(() => {
            const current = menuSessions.get(key);
            if (current && current.time === sessionTime) menuSessions.delete(key);
        }, 60000);
    },
    antiphoto:  async (ctx) => handleShortcut(ctx, "photo"),
    antistk:    async (ctx) => handleShortcut(ctx, "sticker"),
    antitag:    async (ctx) => handleShortcut(ctx, "tag"),
    antilink:   async (ctx) => handleShortcut(ctx, "link"),
    antispam:   async (ctx) => handleShortcut(ctx, "spam"),
    antiundo:   async (ctx) => handleShortcut(ctx, "undo"),
    antinude:   async (ctx) => handleShortcut(ctx, "nude"),

    // Lệnh kiểm tra NSFW thủ công: .nsfw [url] | reply ảnh/video/sticker/voice
    nsfw: async (ctx) => {
        const { api, threadId, threadType, message, args } = ctx;
        const data  = message?.data || {};
        const quote = data?.quote;

        // ── Hỗ trợ .nsfw <url> — kiểm tra trực tiếp từ link ──────────────────
        const firstArg = (args?.[0] || "").trim();
        if (firstArg.startsWith("http://") || firstArg.startsWith("https://")) {
            const directUrl = firstArg;
            await api.sendMessage({ msg: "🔍 Đang phân tích link..." }, threadId, threadType);
            try {
                const backend = await initNsfwBackend();
                if (backend === "none") {
                    return api.sendMessage({ msg: "⚠️ Chưa cài backend NSFW. Bot không thể kiểm tra lúc này." }, threadId, threadType);
                }
                let score = await checkNsfwViaBackend(directUrl);
                // Nếu URL trả về MP4, thử extract frame
                if (score === null) {
                    await api.sendMessage({ msg: "🎬 Link trỏ đến video MP4, đang trích khung hình..." }, threadId, threadType);
                    try {
                        const frameBuf = await extractFrameFromVideo(directUrl);
                        score = await checkNsfwOnBuffer(frameBuf);
                    } catch (fe) {
                        return api.sendMessage({ msg: `⚠️ Không thể phân tích video: ${fe.message}` }, threadId, threadType);
                    }
                }
                if (score === null) return api.sendMessage({ msg: "⚠️ Backend không hỗ trợ phân tích kiểu dữ liệu này." }, threadId, threadType);
                const percent = (score * 100).toFixed(1);
                const isNsfw  = score >= NSFW_THRESHOLD;
                const verdict = isNsfw ? "🔞 NSFW — Nội dung không phù hợp!" : "✅ SAFE — Nội dung an toàn";
                const bar     = "█".repeat(Math.round(score * 10)) + "░".repeat(10 - Math.round(score * 10));
                const backendLabel = backend === "falconsai" ? "falconsai/nsfw_image_detection (HF)" : backend;
                return api.sendMessage({
                    msg: [
                        `[ 🔍 NSFW DETECTOR ]`,
                        `─────────────────`,
                        verdict,
                        `📊 Điểm NSFW: ${percent}%`,
                        `[${bar}] ${percent}%`,
                        `🧠 Backend: ${backendLabel}`,
                        `─────────────────`,
                        `🔗 Link: ${directUrl.slice(0, 80)}${directUrl.length > 80 ? "..." : ""}`,
                        `Ngưỡng phát hiện: ${(NSFW_THRESHOLD * 100).toFixed(0)}%`
                    ].join("\n")
                }, threadId, threadType);
            } catch (e) {
                return api.sendMessage({ msg: `⚠️ Lỗi khi kiểm tra link: ${e.message}` }, threadId, threadType);
            }
        }

        // Phân tích loại media và lấy URL từ một object dữ liệu Zalo
        async function resolveMedia(d) {
            if (!d) return null;
            const rawContent = d.content;
            const msgType    = String(d.msgType || d.type || "");

            // Voice — không thể check ảnh
            if (msgType.includes("voice") || d.type === "voice") {
                return { kind: "voice" };
            }

            // Video — lấy thumbnail + videoUrl thực để fallback
            if (isVideo(d, rawContent)) {
                const url      = getVideoThumbnailUrl(d);
                const videoUrl = getVideoActualUrl(d);
                return { kind: "video", url, videoUrl };
            }

            // Sticker — gọi API lấy URL ảnh thực
            if (isSticker(d, rawContent)) {
                const stickerId = getStickerIdFromData(d);
                if (stickerId) {
                    try {
                        const details = await api.getStickersDetail([stickerId]);
                        const s = Array.isArray(details) ? details[0] : details;
                        const url = s?.thumbUrl || s?.thumb || s?.url || s?.imageUrl || s?.staticImgUrl || null;
                        return { kind: "sticker", url };
                    } catch { return { kind: "sticker", url: null }; }
                }
                return { kind: "sticker", url: null };
            }

            // Ảnh — ưu tiên hdUrl → normalUrl → thumbUrl
            if (isPhoto(d, rawContent)) {
                const url = getPhotoUrl(d, rawContent);
                return { kind: "photo", url };
            }

            // Fallback: thử tìm URL bất kỳ trong attach/content
            const att = _parseContentObj(d.attach);
            if (att) {
                const url = att.hdUrl || att.href || att.url || att.normalUrl || att.thumbUrl || null;
                if (url) return { kind: "photo", url };
            }
            const cnt = _parseContentObj(d.content);
            if (cnt && typeof cnt === "object") {
                const extra = cnt.extra || {};
                const url = extra.hdUrl || extra.url || cnt.hdUrl || cnt.normalUrl || cnt.thumbUrl || null;
                if (url) return { kind: "photo", url };
            }

            return null;
        }

        // Ưu tiên quoted message, sau đó xét chính tin nhắn hiện tại
        const media = (quote ? await resolveMedia(quote) : null) || await resolveMedia(data);
        if (media?.url) log.info(`[NSFW-DBG] kind=${media.kind} url=${media.url.slice(0, 100)}`);
        else log.info(`[NSFW-DBG] quote=${JSON.stringify(quote)?.slice(0,300)} | data.msgType=${data.msgType}`);

        if (!media) {
            return api.sendMessage({
                msg: "📌 Hãy reply một ảnh / video / sticker rồi dùng .nsfw để kiểm tra nhé!"
            }, threadId, threadType);
        }

        // Voice không có ảnh để check
        if (media.kind === "voice") {
            return api.sendMessage({
                msg: "🎤 Tin nhắn thoại không thể kiểm tra nội dung NSFW!"
            }, threadId, threadType);
        }

        if (!media.url) {
            // Video không có thumbnail → set url = videoUrl để ffmpeg xử lý
            if ((media.kind === "video" || media.kind === "photo") && media.videoUrl) {
                media.url = media.videoUrl;
            } else {
                const typeLabel = media.kind === "video" ? "video (không tìm được thumbnail)"
                    : media.kind === "sticker" ? "sticker (không lấy được URL)"
                    : "ảnh";
                return api.sendMessage({
                    msg: `⚠️ Không tìm được URL của ${typeLabel}.\nThử reply trực tiếp vào tin nhắn rồi dùng .nsfw nhé!`
                }, threadId, threadType);
            }
        }

        // Hỗ trợ: .nsfw test → thử falconsai ngay dù chưa đặt làm backend chính
        const forceBackend = (args?.[0] || "").toLowerCase() === "test" ? "falconsai" : null;
        if (forceBackend === "falconsai") {
            const cfg = getAntiNudeConfig();
            if (!cfg.hf_token) {
                return api.sendMessage({
                    msg: [
                        `[ 🧪 TEST FALCONSAI ]`,
                        `─────────────────`,
                        `⚠️ Chưa có HuggingFace token!`,
                        `Thêm vào tokens.json:`,
                        `"antinude": { "hf_token": "hf_xxx..." }`,
                        `─────────────────`,
                        `Lấy token miễn phí tại: huggingface.co/settings/tokens`
                    ].join("\n")
                }, threadId, threadType);
            }
        }

        const kindLabel = media.kind === "video" ? "🎬 Đang phân tích video..."
            : media.kind === "sticker" ? "🎨 Đang phân tích sticker..."
            : "🔍 Đang phân tích ảnh...";
        await api.sendMessage({ msg: kindLabel }, threadId, threadType);

        try {
            const backend = forceBackend || await initNsfwBackend();
            if (backend === "none") {
                return api.sendMessage({
                    msg: "⚠️ Chưa cài backend NSFW (nsfwjs hoặc API key).\nBot không thể kiểm tra lúc này."
                }, threadId, threadType);
            }

            // Dùng forceBackend (test mode) hoặc backend mặc định
            let score = forceBackend === "falconsai"
                ? await checkNsfwViaFalconsai(media.url).catch(() => null)
                : await checkNsfwViaBackend(media.url);
            let videoNote = "";

            // score === null: URL trả về MP4 hoặc format không hỗ trợ (kể cả khi bị
            // nhận nhầm là "photo") → luôn thử extract frame bằng ffmpeg
            if (score === null) {
                const vidSrc = media.videoUrl || media.url;
                await api.sendMessage({ msg: "🎬 URL là video/MP4, đang trích khung hình bằng ffmpeg..." }, threadId, threadType);
                try {
                    const frameBuf = await extractFrameFromVideo(vidSrc);
                    score     = await checkNsfwOnBuffer(frameBuf);
                    videoNote = "\n🎬 Phân tích qua frame trích từ video (ffmpeg)";
                } catch (fe) {
                    return api.sendMessage({
                        msg: [
                            `[ 🔍 NSFW DETECTOR ]`,
                            `─────────────────`,
                            `⚠️ Không thể trích khung hình: ${fe.message}`,
                            `─────────────────`,
                            `💡 CDN Zalo có thể chặn truy cập trực tiếp. Thử dùng .nsfw <link_thumbnail> nhé!`
                        ].join("\n")
                    }, threadId, threadType);
                }
            }

            // Vẫn null sau ffmpeg → không phân tích được
            if (score === null) {
                return api.sendMessage({
                    msg: [
                        `[ 🔍 NSFW DETECTOR ]`,
                        `─────────────────`,
                        `⚠️ Không thể phân tích nội dung này.`,
                        `Backend không hỗ trợ định dạng hoặc dữ liệu bị mã hóa.`,
                        `─────────────────`,
                        `💡 Thử reply vào ảnh tĩnh hoặc dùng .nsfw <link_ảnh> nhé!`
                    ].join("\n")
                }, threadId, threadType);
            }

            const percent = (score * 100).toFixed(1);
            const isNsfw  = score >= NSFW_THRESHOLD;
            const verdict = isNsfw ? "🔞 NSFW — Nội dung không phù hợp!" : "✅ SAFE — Nội dung an toàn";
            const bar = "█".repeat(Math.round(score * 10)) + "░".repeat(10 - Math.round(score * 10));
            const backendLabel = backend === "falconsai"
                ? "falconsai/nsfw_image_detection (HF)"
                : backend;
            const testNote  = forceBackend ? "\n🧪 Chế độ TEST — chưa áp dụng toàn nhóm" : "";
            const mediaNote = videoNote || (media.kind === "video" ? "\n🎬 Đã kiểm tra thumbnail video"
                : media.kind === "sticker" ? "\n🎨 Đã kiểm tra sticker" : "");

            await api.sendMessage({
                msg: [
                    `[ 🔍 NSFW DETECTOR ]`,
                    `─────────────────`,
                    verdict,
                    `📊 Điểm NSFW: ${percent}%`,
                    `[${bar}] ${percent}%`,
                    `🧠 Backend: ${backendLabel}`,
                    `─────────────────`,
                    `Ngưỡng phát hiện: ${(NSFW_THRESHOLD * 100).toFixed(0)}%` + testNote + mediaNote
                ].join("\n")
            }, threadId, threadType);

        } catch (e) {
            await api.sendMessage({
                msg: `⚠️ Lỗi khi kiểm tra: ${e.message}`
            }, threadId, threadType);
        }
    }
};

// ─── AntiUndo helpers ─────────────────────────────────────────────────────────

function _auDownloadFile(url, destPath) {
    return new Promise((resolve) => {
        try {
            const proto = url.startsWith("https") ? https : http;
            const file = fs.createWriteStream(destPath);
            proto.get(url, (res) => {
                if (res.statusCode !== 200) { file.close(); resolve(null); return; }
                res.pipe(file);
                file.on("finish", () => { file.close(); resolve(destPath); });
            }).on("error", () => { file.close(); resolve(null); });
        } catch { resolve(null); }
    });
}

function _auParseParams(params) {
    if (!params) return {};
    if (typeof params === "object") return params;
    try { return JSON.parse(params); } catch { }
    try { return Object.fromEntries(new URLSearchParams(params)); } catch { }
    return {};
}

function _auBuildNotify(label, authorName, _authorId, extra = "") {
    const safeName = (authorName && authorName !== "undefined" && authorName !== "0")
        ? authorName : "Ai đó";
    const header = `UNDO ${label}`;
    const authorTag = `@${safeName}`;
    const line1 = `➜ [ ${header} ]`;
    const line2 = `${authorTag} vừa thu hồi một ${label.toLowerCase()}.`;
    const text = extra ? `${line1}\n${line2}\n${extra}` : `${line1}\n${line2}`;

    const headerStart = 2;
    const nameStart = line1.length + 1;
    const styles = [
        { start: headerStart, len: header.length + 4, st: "b,c_db342e,f_18" },
        { start: nameStart, len: authorTag.length, st: "b" }
    ];
    return { text, styles, mentions: [] };
}

function _auCacheGet(key) {
    if (!key && key !== 0) return null;
    return messageCache.get(key) || messageCache.get(Number(key)) || messageCache.get(String(key)) || null;
}

// ─── AntiUndo handler ─────────────────────────────────────────────────────────

export async function handleUndo(ctx) {
    const { api, threadId, threadType, senderId: authorId, senderName: eventSenderName, msgId, cliMsgId } = ctx;

    if (!protectionManager.isEnabled(threadId, "undo")) return;

    const ownId = api.getOwnId();
    const { adminIds = [] } = ctx;
    if (String(authorId) === String(ownId) || adminIds.includes(String(authorId))) return;

    const cached = (msgId ? _auCacheGet(msgId) : null)
        || (cliMsgId ? _auCacheGet(cliMsgId) : null);

    const safeAuthorId = (authorId && authorId !== "0") ? authorId : "";
    let authorName = (eventSenderName && eventSenderName !== "undefined" && eventSenderName !== "0")
        ? eventSenderName : null;

    if (!cached) {
        log.warn(`[AntiUndo] ❌ Không tìm thấy tin gốc trong cache. msgId=${msgId}, cliMsgId=${cliMsgId}`);
        try {
            if (!authorName) {
                authorName = safeAuthorId ? await getDisplayName(api, safeAuthorId).catch(() => null) : null;
            }
            authorName = authorName || "Ai đó";
            const { text, styles, mentions } = _auBuildNotify("TIN NHẮN", authorName, safeAuthorId,
                "➜ (Không có trong cache - tin nhắn quá cũ hoặc bot chưa thấy)");
            await api.sendMessage({ msg: text, mentions, styles }, threadId, threadType);
        } catch (e) {
            log.error(`[AntiUndo] Lỗi gửi thông báo fallback: ${e.message}`);
        }
        return;
    }

    const { senderId: cachedSenderId, senderName: rawName, content: originalText, data: originalData } = cached;
    const resolvedSenderId = (cachedSenderId && cachedSenderId !== "0") ? cachedSenderId
        : safeAuthorId || "";

    if (!authorName) {
        authorName = (rawName && rawName !== "0" && rawName !== "undefined") ? rawName : null;
    }
    if (!authorName && resolvedSenderId) {
        try { authorName = await getDisplayName(api, resolvedSenderId) || null; } catch { }
    }
    authorName = authorName || "Ai đó";

    const msgType    = originalData?.msgType || "";
    const rawContent = originalData?.content;
    const rawAttach  = originalData?.attach;

    let c = {};
    if (typeof rawContent === "object" && rawContent !== null) {
        c = rawContent;
    } else if (typeof rawContent === "string") {
        try { c = JSON.parse(rawContent); } catch { c = {}; }
    }

    let attach = {};
    if (typeof rawAttach === "object" && rawAttach !== null) {
        attach = rawAttach;
    } else if (typeof rawAttach === "string") {
        try { attach = JSON.parse(rawAttach); } catch { attach = {}; }
    }

    const stickerId  = c?.id  || attach?.id  || c?.stickerID  || attach?.stickerID;
    const stickerCat = c?.catId || attach?.catId || c?.catID || attach?.catID;

    const extra      = c?.extra || attach?.extra || {};
    const rawParams  = c?.params || attach?.params || originalData?.params || "";
    const parsedParams = _auParseParams(rawParams);

    // ── VIDEO ──
    const isVideoMsg = msgType.startsWith("chat.video")
        || !!extra?.videoUrl || !!c?.videoUrl
        || ("video_width" in parsedParams);

    if (isVideoMsg) {
        const videoUrl = extra?.videoUrl || c?.videoUrl || c?.href;
        const thumbUrl = extra?.thumbUrl  || c?.thumb   || videoUrl;
        const duration = Number(parsedParams?.duration || extra?.duration || 0);
        const width    = Number(parsedParams?.video_width  || extra?.width  || 720);
        const height   = Number(parsedParams?.video_height || extra?.height || 1280);

        if (videoUrl) {
            try {
                const { text, styles, mentions } = _auBuildNotify("VIDEO", authorName, resolvedSenderId);
                await api.sendMessage({ msg: text, mentions, styles }, threadId, threadType);
                await api.sendVideoEnhanced({ videoUrl, thumbnailUrl: thumbUrl, duration: Math.floor(duration), width: Math.floor(width), height: Math.floor(height), msg: "", threadId, threadType });
                log.success(`[AntiUndo] ✅ Đã tóm VIDEO của ${authorName}`);
            } catch (e) { log.error(`[AntiUndo] Lỗi VIDEO: ${e.message}`); }
            return;
        }
    }

    // ── VOICE ──
    const isVoice = msgType.startsWith("chat.voice")
        || msgType.startsWith("chat.audio")
        || (typeof c?.href === "string" && (c.href.includes(".aac") || c.href.includes(".m4a")));

    if (isVoice && c?.href) {
        try {
            const fileSize = Number(parsedParams?.fileSize || 0);
            const duration = Number(parsedParams?.duration || 0);
            const { text, styles, mentions } = _auBuildNotify("VOICE", authorName, resolvedSenderId);
            await api.sendMessage({ msg: text, mentions, styles }, threadId, threadType);
            await api.sendVoiceNative({
                voiceUrl: c.href, duration, fileSize, threadId, threadType, ttl: 1800000
            }).catch(async (e) => {
                log.warn(`[AntiUndo] sendVoiceNative thất bại (${e.message}), thử fallback...`);
                const tmpPath = path.join(process.cwd(), `tmp_voice_${Date.now()}.aac`);
                const downloaded = await _auDownloadFile(c.href, tmpPath);
                if (downloaded) {
                    await api.sendVoiceUnified({ filePath: downloaded, threadId, threadType })
                        .finally(() => fs.unlink(downloaded, () => {}));
                } else {
                    await api.sendMessage({ msg: `🎵 Voice: ${c.href}` }, threadId, threadType);
                }
            });
            log.success(`[AntiUndo] ✅ Đã tóm VOICE của ${authorName}`);
        } catch (e) { log.error(`[AntiUndo] Lỗi VOICE: ${e.message}`); }
        return;
    }

    // ── FILE ──
    if (msgType === "share.file" || msgType.includes("file")) {
        try {
            const fileUrl   = c?.href || "";
            const fileName  = parsedParams?.fileName  || "Tệp_đính_kèm";
            const fileExt   = parsedParams?.fileExt   || "";
            const fullName  = fileExt ? `${fileName}.${fileExt}` : fileName;
            const extra_str = `➜ Tên tệp: ${fullName}` + (fileUrl ? `\n➜ Link: ${fileUrl}` : "");
            const { text, styles, mentions } = _auBuildNotify("TỆP", authorName, resolvedSenderId, extra_str);
            await api.sendMessage({ msg: text, mentions, styles }, threadId, threadType);
            if (fileUrl) {
                await api.sendFile({ fileUrl, fileName: fullName }, threadId, threadType).catch(() => { });
            }
            log.success(`[AntiUndo] ✅ Đã tóm FILE của ${authorName}: ${fullName}`);
        } catch (e) { log.error(`[AntiUndo] Lỗi FILE: ${e.message}`); }
        return;
    }

    // ── ẢNH ──
    const isPhotoMsg = msgType.startsWith("chat.photo")
        || !!(extra?.hdUrl || extra?.url || extra?.thumbUrl || extra?.normalUrl);

    if (isPhotoMsg) {
        const imgUrl = extra?.hdUrl || extra?.url || extra?.normalUrl || extra?.thumbUrl || c?.href;
        if (imgUrl) {
            try {
                const tmpPath = path.join(process.cwd(), `tmp_undo_${Date.now()}.jpg`);
                await _auDownloadFile(imgUrl, tmpPath);
                const { text, styles, mentions } = _auBuildNotify("ẢNH", authorName, resolvedSenderId);
                await api.sendMessage({ msg: text, mentions, styles }, threadId, threadType);
                await api.sendImageEnhanced({
                    imageUrl: imgUrl, msg: "", threadId, threadType,
                    width:  Math.floor(Number(extra?.width  || 720)),
                    height: Math.floor(Number(extra?.height || 1280))
                }).catch(() => { });
                fs.unlink(tmpPath, () => { });
                log.success(`[AntiUndo] ✅ Đã tóm ẢNH của ${authorName}`);
            } catch (e) { log.error(`[AntiUndo] Lỗi ẢNH: ${e.message}`); }
            return;
        }
    }

    // ── STICKER ──
    const isStickerMsg = msgType.startsWith("chat.sticker")
        || !!(stickerId && stickerCat);

    if (isStickerMsg && stickerId && stickerCat) {
        try {
            const stickerObj = { id: String(stickerId), cateId: String(stickerCat), type: 1 };
            const { text, styles, mentions } = _auBuildNotify("STICKER", authorName, resolvedSenderId);
            await api.sendMessage({ msg: text, mentions, styles }, threadId, threadType);
            await api.sendSticker(stickerObj, threadId, threadType === 1 ? 1 : 0).catch((e) => {
                log.error(`[AntiUndo] sendSticker API Error: ${e.message}`);
                api.sendSticker(stickerObj, threadId, threadType).catch(() => { });
            });
            log.success(`[AntiUndo] ✅ Đã tóm STICKER id=${stickerId} cat=${stickerCat} của ${authorName}`);
        } catch (e) { log.error(`[AntiUndo] Lỗi STICKER: ${e.message}`); }
        return;
    }

    // ── VĂN BẢN ──
    const displayText = originalText
        || (typeof rawContent === "string" ? rawContent : null)
        || c?.text || c?.title || c?.desc || "";

    if (displayText) {
        try {
            const { text, styles, mentions } = _auBuildNotify("TIN NHẮN", authorName, resolvedSenderId,
                `➜ Nội dung: "${displayText}"`);
            await api.sendMessage({ msg: text, mentions, styles }, threadId, threadType);
            log.success(`[AntiUndo] ✅ Đã tóm TEXT của ${authorName}: "${displayText.slice(0, 50)}"`);
        } catch (e) { log.error(`[AntiUndo] Lỗi TEXT: ${e.message}`); }
        return;
    }

    log.warn(`[AntiUndo] ⚠️ Không xử lý được. msgType="${msgType}" | content=${JSON.stringify(c).slice(0, 100)}`);
    try {
        const { text, styles, mentions } = _auBuildNotify("TIN NHẮN", authorName, resolvedSenderId,
            "➜ (Không thể khôi phục nội dung tin nhắn này)");
        await api.sendMessage({ msg: text, mentions, styles }, threadId, threadType);
    } catch { }
}

// ─── Handle: bảo vệ nhóm + reply số menu ─────────────────────────────────────

export async function handle(ctx) {
    const { message, threadId, threadType, senderId, adminIds, isGroup, api, content, isSelf } = ctx;
    if (isSelf) return false;
    if (!isGroup) return false;

    const { data } = message;
    const now = Date.now();

    // Bảo vệ nhóm (chỉ áp dụng với non-admin)
    if (!adminIds.includes(String(senderId))) {
        // 1. Anti-Link
        if (protectionManager.isEnabled(threadId, "link")) {
            let textToCheck = content || "";
            if (!textToCheck && data?.content) {
                textToCheck = typeof data.content === "string" ? data.content : (data.content.href || data.content.text || "");
            }
            if (textToCheck && ZALO_GROUP_LINK_REGEX.test(textToCheck)) {
                await handleDeleteAndReport(ctx, "link_del", 0);
                return true;
            }
        }

        // 2. Anti-Spam
        if (protectionManager.isEnabled(threadId, "spam")) {
            const key = `${threadId}_${senderId}`;
            const oneMinuteAgo = now - 60000;
            if (!kickHistoryMap.has(threadId)) kickHistoryMap.set(threadId, []);
            const kickHistory = kickHistoryMap.get(threadId);
            while (kickHistory.length > 0 && kickHistory[0] < oneMinuteAgo) kickHistory.shift();
            if (!spamData.has(key)) {
                spamData.set(key, [now]);
            } else {
                const timestamps = spamData.get(key);
                const recentMsgs = timestamps.filter(t => now - t < TIME_LIMIT);
                recentMsgs.push(now);
                spamData.set(key, recentMsgs);
                if (recentMsgs.length >= MSG_LIMIT && kickHistory.length < MAX_KICKS_PER_MIN) {
                    spamData.set(key, []);
                    const count = protectionManager.addViolation(threadId, senderId, "spam");
                    await handleDeleteAndReport(ctx, "spam", count);
                    kickHistory.push(now);
                    return true;
                }
            }
        }

        // 3. Anti-Tag
        if (protectionManager.isEnabled(threadId, "tag")) {
            const mentions = data.mentions || [];
            if (mentions.some(m => m.uid === "-1" || m.uid === -1)) {
                const count = protectionManager.addViolation(threadId, senderId, "tag");
                await handleDeleteAndReport(ctx, "tag", count);
                return true;
            }
        }

        // 4. Anti-Sticker
        if (protectionManager.isEnabled(threadId, "sticker")) {
            if (isSticker(data, content)) {
                const count = protectionManager.addViolation(threadId, senderId, "sticker");
                await handleDeleteAndReport(ctx, "sticker", count);
                return true;
            }
        }

        // 5. Anti-Nude (ảnh/video/sticker + link ảnh trong text)
        if (protectionManager.isEnabled(threadId, "nude")) {
            const mediaIsPhoto   = isPhoto(data, content);
            const mediaIsVideo   = !mediaIsPhoto && isVideo(data, content);
            const mediaIsSticker = !mediaIsPhoto && !mediaIsVideo && isSticker(data, content);

            // ── 5a. Kiểm tra media đính kèm (ảnh/video/sticker) ──────────────
            if (mediaIsPhoto || mediaIsVideo || mediaIsSticker) {
                let nude = false;
                if (mediaIsPhoto) {
                    const url = getPhotoUrl(data, content);
                    if (url) nude = await checkNsfw(url).catch(() => false);
                } else if (mediaIsVideo) {
                    const thumbUrl = getVideoThumbnailUrl(data);
                    const videoUrl = getVideoActualUrl(data);
                    // Thử thumbnail trước, nếu MP4 thì extract frame từ video
                    const score = await checkNsfwVideo(thumbUrl, videoUrl).catch(() => null);
                    nude = score !== null && score >= NSFW_THRESHOLD;
                } else if (mediaIsSticker) {
                    const stickerId = getStickerIdFromData(data);
                    if (stickerId) {
                        try {
                            const details = await api.getStickersDetail([stickerId]);
                            const d = Array.isArray(details) ? details[0] : details;
                            const url = d?.thumbUrl || d?.thumb || d?.url || d?.imageUrl || d?.staticImgUrl || null;
                            if (url) nude = await checkNsfw(url).catch(() => false);
                        } catch {
                            // Không lấy được sticker detail
                        }
                    }
                }
                if (nude) {
                    const count = protectionManager.addViolation(threadId, senderId, "nude");
                    await handleDeleteAndReport(ctx, "nude", count);
                    return true;
                }
            }

            // ── 5b. Kiểm tra link trong văn bản (ảnh + video URL) ────────────
            if (!mediaIsPhoto && !mediaIsVideo && !mediaIsSticker) {
                const textToScan = content
                    || (typeof data?.content === "string" ? data.content : null)
                    || data?.content?.text || "";
                const links = extractAllUrlsFromText(textToScan, 5);
                for (const { url, hint: hintExt } of links) {
                    try {
                        // Xác định loại thực sự qua HEAD nếu chưa rõ
                        const kind = hintExt !== "unknown" ? hintExt : await probeUrlContentType(url);
                        let nude = false;
                        if (kind === "image") {
                            nude = await checkNsfw(url).catch(() => false);
                        } else if (kind === "video") {
                            // Thử extract frame rồi check
                            try {
                                const frameBuf = await extractFrameFromVideo(url);
                                const score = await checkNsfwOnBuffer(frameBuf).catch(() => null);
                                nude = score !== null && score >= NSFW_THRESHOLD;
                            } catch { /* video không trích được */ }
                        } else {
                            // "unknown" — thử HEAD đã fail hoặc không nhận dạng được
                            // Vẫn thử check như ảnh (backend sẽ trả null nếu format lạ)
                            const score = await checkNsfwViaBackend(url).catch(() => null);
                            nude = score !== null && score >= NSFW_THRESHOLD;
                        }
                        if (nude) {
                            const count = protectionManager.addViolation(threadId, senderId, "nude");
                            await handleDeleteAndReport(ctx, "nude", count);
                            return true;
                        }
                    } catch { /* bỏ qua lỗi từng link */ }
                }
            }
        }

        // 6. Anti-Photo
        if (protectionManager.isEnabled(threadId, "photo")) {
            if (isPhoto(data, content)) {
                const count = protectionManager.addViolation(threadId, senderId, "photo");
                await handleDeleteAndReport(ctx, "photo", count);
                return true;
            }
        }
    }

    // Reply số từ menu .anti
    if (!content || isSelf) return false;
    const key = `${threadId}_${senderId}`;
    if (!menuSessions.has(key)) return false;
    const cleanContent = content.trim();
    if (/^[1-7]+$/.test(cleanContent)) {
        menuSessions.delete(key);
        if (!adminIds.includes(String(senderId))) return false;
        const ids = [...new Set(cleanContent.split(""))];
        const selectedItems = PROTECTION_TYPES.filter(p => ids.includes(p.id));
        if (selectedItems.length > 0) {
            await toggleProtection(api, threadId, threadType, senderId, selectedItems);
            return true;
        }
    }

    return false;
}
