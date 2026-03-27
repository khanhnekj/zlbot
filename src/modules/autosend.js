/**
 * Module: Autosend (v4.4 - Won Canvas Card) 🚀
 * Tự động gửi Media mỗi giờ + Card ảnh tỷ giá Won→VND bằng Canvas
 */

import fs from "node:fs";
import path from "node:path";
import moment from "moment-timezone";
import axios from "axios";
import { exec } from "child_process";
import { log } from "../logger.js";
import { statsManager } from "../utils/managers/statsManager.js";
import { rentalManager } from "../utils/managers/rentalManager.js";
import { tempDir } from "../utils/core/io-json.js";
import { searchNCT } from "../utils/music/nhaccuatui.js";
import { drawWonCard } from "../utils/canvas/canvasHelper.js";

// ─── Paths ─────────────────────────────────────────────────────────────────
const CONFIG_PATH    = path.join(process.cwd(), "src/modules/cache/autosend_v3_settings.json");
const HISTORY_PATH   = path.join(process.cwd(), "src/modules/cache/autosend_history.json");
const RATE_HIST_PATH = path.join(process.cwd(), "src/modules/cache/won_rate_history.json");

const MEDIA_PATHS = {
    video_gai: path.join(process.cwd(), "src/modules/cache/gai.json"),
    anime:     path.join(process.cwd(), "src/modules/cache/vdanime.json"),
    anh_gai:   path.join(process.cwd(), "src/modules/cache/anhgai.json"),
    rap:   path.join(process.cwd(), "src/modules/cache/rap.json")
};

const sysBrand = "[ SYSTEM ]: ";

// ─── Tỷ giá runtime cache ──────────────────────────────────────────────────
let rateCache = { krwToVnd: null, updatedAt: null };

// ─── Lịch sử tỷ giá (persist qua restart) ─────────────────────────────────
const RATE_HIST_MAX = 168;

function loadRateHistory() {
    try {
        if (!fs.existsSync(RATE_HIST_PATH)) return [];
        return JSON.parse(fs.readFileSync(RATE_HIST_PATH, "utf-8"));
    } catch { return []; }
}

function saveRateHistory(hist) {
    try {
        const dir = path.dirname(RATE_HIST_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(RATE_HIST_PATH, JSON.stringify(hist, null, 2), "utf-8");
    } catch { }
}

function pushRateHistory(rate) {
    const hist = loadRateHistory();
    hist.push({ rate, ts: new Date().toISOString() });
    if (hist.length > RATE_HIST_MAX) hist.splice(0, hist.length - RATE_HIST_MAX);
    saveRateHistory(hist);
}

// ─── Fetch tỷ giá ──────────────────────────────────────────────────────────
async function fetchExchangeRates() {
    try {
        const res = await axios.get("https://open.er-api.com/v6/latest/KRW", { timeout: 10000 });
        if (res.data?.rates?.VND) {
            rateCache.krwToVnd = res.data.rates.VND;
            rateCache.updatedAt = moment().tz("Asia/Ho_Chi_Minh").format("HH:mm  DD/MM/YYYY");
            pushRateHistory(rateCache.krwToVnd);
            log.system(`💱 Tỷ giá: 1 KRW = ${rateCache.krwToVnd.toFixed(2)} VND`);
            return;
        }
    } catch { }
    try {
        const res2 = await axios.get("https://api.exchangerate-api.com/v4/latest/KRW", { timeout: 10000 });
        if (res2.data?.rates?.VND) {
            rateCache.krwToVnd = res2.data.rates.VND;
            rateCache.updatedAt = moment().tz("Asia/Ho_Chi_Minh").format("HH:mm  DD/MM/YYYY");
            pushRateHistory(rateCache.krwToVnd);
            log.system(`💱 Tỷ giá (backup): 1 KRW = ${rateCache.krwToVnd.toFixed(2)} VND`);
        }
    } catch { }
}

// ─── Format số ─────────────────────────────────────────────────────────────
function fmtVND(n)  { return Math.round(n).toLocaleString("vi-VN"); }
function fmtKRW(n)  { return Math.round(n).toLocaleString("vi-VN"); }

// ─── Parse số kiểu Việt Nam: 1tr / 500k / 1.5tr / 1ty ─────────────────────
function parseViNum(str) {
    if (!str) return null;
    const s = str.trim().toLowerCase().replace(/,/g, "").replace(/\s/g, "");
    const m = s.match(/^([\d.]+)(tr(?:ieu|iệu)?|k|ty|tỷ)?$/);
    if (!m) return null;
    const num = parseFloat(m[1]);
    if (isNaN(num) || num <= 0) return null;
    const u = m[2] || "";
    if (u.startsWith("tr")) return num * 1_000_000;
    if (u === "k")           return num * 1_000;
    if (u === "ty" || u === "tỷ") return num * 1_000_000_000;
    return num;
}

// ─── AI: linear regression ─────────────────────────────────────────────────
function aiPredict(values) {
    const n = values.length;
    if (n < 3) return null;
    const xM = (n - 1) / 2;
    const yM = values.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    values.forEach((y, x) => { num += (x - xM) * (y - yM); den += (x - xM) ** 2; });
    const slope = den === 0 ? 0 : num / den;
    return (yM - slope * xM) + slope * n;
}

// ─── % thay đổi so với N giờ trước ────────────────────────────────────────
function calcChange(hist, hoursAgo = 24) {
    if (!hist || hist.length < 2) return null;
    const cutoff = new Date(Date.now() - hoursAgo * 3600000);
    const old    = hist.find(h => new Date(h.ts) <= cutoff);
    const cur    = hist[hist.length - 1];
    if (!old || !cur) return null;
    return { pct: ((cur.rate - old.rate) / old.rate) * 100, oldRate: old.rate };
}

// ── drawWonCard imported from canvasHelper.js ──────────────────────────────
// Uses same BeVietnamProBold font + dark navy style as SYSTEM UPTIME card.

// ─── Build rate block (text) cho autosend caption ──────────────────────────
function buildRateBlock() {
    if (!rateCache.krwToVnd) return "";
    const rate  = rateCache.krwToVnd;
    const hist  = loadRateHistory();
    const chg   = calcChange(hist, 24);
    let chgStr  = "";
    if (chg !== null) {
        const s = chg.pct >= 0 ? "+" : "";
        const i = chg.pct > 0.05 ? "tang" : chg.pct < -0.05 ? "giam" : "on dinh";
        chgStr = `\n${i} ${s}${chg.pct.toFixed(2)}% hom nay`;
    }
    return (
        `\n─────────────────` +
        `\n TY GIA WON → VND` +
        `\n 1.000 KRW  =  ${fmtVND(rate * 1000)} VND` +
        `\n 10.000 KRW =  ${fmtVND(rate * 10000)} VND` +
        chgStr +
        `\n Cap nhat: ${rateCache.updatedAt}`
    );
}

// ─── Gửi card ảnh (dùng drawWonCard từ canvasHelper — style uptime) ─────────
async function sendWonCard(api, threadId, threadType, opts, caption = "") {
    const buf      = drawWonCard(opts);
    const imgPath  = path.join(tempDir, `won_card_${Date.now()}.png`);
    try {
        fs.writeFileSync(imgPath, buf);
        await api.sendMessage({ msg: caption, attachments: [imgPath] }, threadId, threadType);
    } finally {
        if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    }
}

// ─── Data helpers ──────────────────────────────────────────────────────────
function loadData(file) {
    try {
        if (!fs.existsSync(file)) return file === CONFIG_PATH ? {} : [];
        return JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch { return file === CONFIG_PATH ? {} : []; }
}

function saveData(file, data) {
    try {
        const dir = path.dirname(file);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
    } catch { }
}

async function getUniqueMedia(type) {
    try {
        if (type === "nct") {
            const hotSongs = await searchNCT("top 10 nhạc trẻ");
            const song = hotSongs[Math.floor(Math.random() * hotSongs.length)] || null;
            return song ? { url: song, resolvedType: "nct" } : null;
        }

        // Danh sách file ưu tiên fallback theo thứ tự
        const fallbackChain = {
            video_gai: ["video_gai", "anh_gai"],
            anime:     ["anime",     "anh_gai"],
            anh_gai:   ["anh_gai", "rap"],
        };
        const chain = fallbackChain[type] || [type, "anh_gai"];

        let filePath = null;
        let resolvedType = null;
        for (const t of chain) {
            const p = MEDIA_PATHS[t] || path.join(process.cwd(), "src/modules/cache", `${t}.json`);
            if (fs.existsSync(p)) { filePath = p; resolvedType = t; break; }
        }
        if (!filePath) {
            log.warn(`[autosend] Không tìm thấy file media cho type "${type}" và tất cả fallback.`);
            return null;
        }
        if (resolvedType !== type) {
            log.info(`[autosend] Dùng fallback "${resolvedType}" thay cho "${type}".`);
        }

        const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        const list = Array.isArray(data) ? data : (data.urls || data.data || []);
        if (list.length === 0) return null;
        const history    = loadData(HISTORY_PATH);
        const filtered   = list.filter(u => !history.includes(u));
        const targetList = filtered.length > 0 ? filtered : list;
        if (filtered.length === 0) saveData(HISTORY_PATH, []);
        const selected = targetList[Math.floor(Math.random() * targetList.length)];
        if (filtered.length > 0) {
            history.push(selected);
            if (history.length > 1000) history.shift();
            saveData(HISTORY_PATH, history);
        }
        return { url: selected, resolvedType };
    } catch (e) {
        log.error(`[autosend] getUniqueMedia lỗi: ${e.message}`);
        return null;
    }
}

async function processImage(inputPath, outputPath, hour) {
    try {
        let createCanvas, loadImage;
        try {
            const canvasMod = await import("canvas");
            createCanvas = canvasMod.createCanvas;
            loadImage = canvasMod.loadImage;
        } catch { return false; }
        const img = await loadImage(inputPath);
        const canvas = createCanvas(img.width, img.height);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        const overlayW = 400, overlayH = 120, x = 30, y = 30;
        ctx.fillStyle = "rgba(0, 0, 0, 0.6)"; ctx.fillRect(x, y, overlayW, overlayH);
        ctx.strokeStyle = "#00afea"; ctx.lineWidth = 4; ctx.strokeRect(x, y, overlayW, overlayH);
        ctx.fillStyle = "#ffffff"; ctx.font = "bold 35px Sans"; ctx.fillText(`THONG BAO GIO MOI`, x + 20, y + 50);
        ctx.fillStyle = "#00afea"; ctx.font = "bold 45px Sans"; ctx.fillText(`${hour}:00`, x + 20, y + 100);
        fs.writeFileSync(outputPath, canvas.toBuffer("image/jpeg"));
        return true;
    } catch { return false; }
}

async function processVideo(inputPath, outputPath, hour) {
    return new Promise((resolve) => {
        const drawtext = `drawtext=text='THONG BAO GIO MOI - ${hour}\\:00':fontcolor=white:fontsize=40:box=1:boxcolor=black@0.5:boxborderw=10:x=(w-text_w)/2:y=h-80`;
        const cmd = `ffmpeg -y -i "${inputPath}" -vf "${drawtext}" -codec:a copy -t 15 "${outputPath}"`;
        exec(cmd, (err) => resolve(!err));
    });
}

// ─── Main ticker ───────────────────────────────────────────────────────────
export async function startAutosendTicker(api) {
    log.system("⏳ Động cơ Autosend v4.4 (Won Canvas Card) đã sẵn sàng!");
    await fetchExchangeRates();

    let lastFiredHour = -1;
    setInterval(async () => {
        const now    = moment().tz("Asia/Ho_Chi_Minh");
        const minute = now.minute();
        const hour   = now.hour();

        // Cho phép window 0-2 phút để tránh miss do event loop trễ
        if (hour !== lastFiredHour && minute < 3) {
            lastFiredHour = hour;
            await fetchExchangeRates();

            const settings = loadData(CONFIG_PATH);

            // Ưu tiên duyệt đúng các thread đã cài autosend, không phụ thuộc vào statsManager
            const configuredThreads = Object.keys(settings);
            const activeThreads     = statsManager.getAllThreads();
            const threads = [...new Set([...configuredThreads, ...activeThreads])];

            for (const tid of threads) {
                const config = settings[tid];
                if (!config || !config.enabled) continue;
                // Bỏ check isRented nếu thread trong settings thì luôn cho phép gửi
                const isAllowed = configuredThreads.includes(tid) || rentalManager.isRented(tid);
                if (!isAllowed) continue;

                try {
                    const media = await getUniqueMedia(config.type);
                    if (!media) {
                        log.warn(`[autosend] Không có media cho thread ${tid} (type: ${config.type})`);
                        continue;
                    }

                    const { url: mediaRaw, resolvedType } = media;

                    const rateBlock  = buildRateBlock();
                    const msgCaption =
                        `[ SYSTEM NOTIFICATION ]\n` +
                        `─────────────────\n` +
                        `Bây giờ là: ${hour}:00\n` +
                        `Chúc nhóm mình một giờ mới tốt lành!` +
                        rateBlock +
                        `\n─────────────────`;

                    if (resolvedType === "nct") {
                        const song   = mediaRaw;
                        const stream = song.streamURL?.find(s => s.type === "320") || song.streamURL?.[0];
                        if (stream?.stream) {
                            await api.sendMessage({ msg: msgCaption + `\nGoi y nhac: ${song.name}` }, tid, 1);
                            await api.sendVoiceNative({ voiceUrl: stream.stream, duration: song.duration || 0, threadId: tid, threadType: 1 });
                        }
                        continue;
                    }

                    const mediaUrl = typeof mediaRaw === "string" ? mediaRaw : (mediaRaw.urls?.[0] || mediaRaw.url);
                    const isVideo  = resolvedType !== "anh_gai";
                    const ext      = isVideo ? "mp4" : "jpg";
                    const tempIn   = path.join(tempDir, `in_${Date.now()}.${ext}`);
                    const tempOut  = path.join(tempDir, `out_${Date.now()}.${ext}`);

                    try {
                        const response = await axios({ method: "get", url: mediaUrl, responseType: "stream", timeout: 60000 });
                        const writer   = fs.createWriteStream(tempIn);
                        response.data.pipe(writer);
                        await new Promise((res, rej) => { writer.on("finish", res); writer.on("error", rej); });
                        let success = isVideo ? await processVideo(tempIn, tempOut, hour) : await processImage(tempIn, tempOut, hour);
                        const finalFile = success ? tempOut : tempIn;
                        if (isVideo) await api.sendVideoUnified({ videoPath: finalFile, msg: msgCaption, threadId: tid, threadType: 1 });
                        else         await api.sendMessage({ msg: msgCaption, attachments: [finalFile] }, tid, 1);
                    } catch (e) {
                        log.error(`[autosend] Gửi media lỗi (${tid}): ${e.message}`);
                    } finally {
                        if (fs.existsSync(tempIn))  fs.unlinkSync(tempIn);
                        if (fs.existsSync(tempOut)) fs.unlinkSync(tempOut);
                    }
                } catch (e) {
                    log.error(`[autosend] Lỗi xử lý thread ${tid}: ${e.message}`);
                }
            }
        }
    }, 60000);
}

// ─── Won command handler ────────────────────────────────────────────────────
async function handleWonCommand(ctx) {
    const { api, threadId, threadType, args } = ctx;

    if (!rateCache.krwToVnd) {
        await api.sendMessage({ msg: `${sysBrand}Dang lay ty gia thuc te...` }, threadId, threadType);
        await fetchExchangeRates();
    }
    if (!rateCache.krwToVnd) {
        return api.sendMessage({ msg: `${sysBrand}Khong the lay ty gia luc nay. Thu lai sau!` }, threadId, threadType);
    }

    const rate       = rateCache.krwToVnd;
    const hist       = loadRateHistory();
    const chartRates = hist.slice(-24).map(h => h.rate);
    const changeData = calcChange(hist, 24);
    const predicted  = aiPredict(hist.slice(-24).map(h => h.rate));
    const updatedAt  = rateCache.updatedAt;

    const raw = args.join("").trim();

    if (raw) {
        const krwAmount = parseViNum(raw);
        if (!krwAmount) {
            return api.sendMessage({
                msg: `${sysBrand}Khong hieu "${raw}".\nVi du: !won 10000 | !won 1tr | !won 500k`
            }, threadId, threadType);
        }
        await sendWonCard(api, threadId, threadType, {
            krwAmount, rate, changeData, chartRates, predicted, updatedAt
        });
    } else {
        await sendWonCard(api, threadId, threadType, {
            krwAmount: null, rate, changeData, chartRates, predicted, updatedAt
        });
    }
}

// ─── Commands ──────────────────────────────────────────────────────────────
export const commands = {
    autosend: async (ctx) => {
        const { api, threadId, threadType, args, senderId, adminIds } = ctx;
        if (!adminIds.includes(String(senderId))) return;

        const action   = args[0]?.toLowerCase();
        const settings = loadData(CONFIG_PATH);

        if (action === "on") {
            settings[threadId] = { enabled: true, type: settings[threadId]?.type || "video_gai" };
            saveData(CONFIG_PATH, settings);
            return api.sendMessage({ msg: `${sysBrand}Da BAT Autosend! Bot se gui Media kem card ty gia Won moi gio.` }, threadId, threadType);
        } else if (action === "off") {
            if (settings[threadId]) settings[threadId].enabled = false;
            saveData(CONFIG_PATH, settings);
            return api.sendMessage({ msg: `${sysBrand}Da TAT Autosend.` }, threadId, threadType);
        } else if (["video", "anime", "anh", "nct"].includes(action)) {
            const typeMap = { video: "video_gai", anime: "anime", anh: "anh_gai", nct: "nct" };
            settings[threadId] = { enabled: true, type: typeMap[action] };
            saveData(CONFIG_PATH, settings);
            return api.sendMessage({ msg: `${sysBrand}Da doi loai: ${action.toUpperCase()}!` }, threadId, threadType);
        } else {
            const config = settings[threadId];
            const status = config?.enabled ? "DANG BAT" : "DANG TAT";
            const ri     = rateCache.krwToVnd
                ? `\nTy gia: 1 KRW = ${rateCache.krwToVnd.toFixed(2)} VND`
                : `\nTy gia: Chua cap nhat`;
            return api.sendMessage({
                msg: `${sysBrand}CAI DAT AUTOSEND\n!autosend on/off | video | anime | anh | nct\nTrang thai: ${status}\nLoai: ${config?.type || "N/A"}` + ri
            }, threadId, threadType);
        }
    },

    won:   handleWonCommand,
    tygia: handleWonCommand,
};
