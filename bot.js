import "./src/utils/globals.js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import qrTerminal from "qrcode-terminal";
import { Zalo } from "./src/api-zalo/index.js";
import sizeOf from "image-size";
import ffmpeg from "fluent-ffmpeg";
import { execSync } from "node:child_process";
import { loadModules } from "./src/modules/index.js";
import { loadEvents } from "./src/events/index.js";
import { log } from "./src/logger.js";
import { rentalManager } from "./src/utils/managers/rentalManager.js";
import { statsManager } from "./src/utils/managers/statsManager.js";
import { autoReactManager } from "./src/utils/managers/autoReactManager.js";
import { cleanTempFiles, cleanupOldFiles } from "./src/utils/core/io-json.js";
import { handleListen } from "./src/utils/listen.js";
import { registerCustomApi } from "./src/utils/customApi.js";
import { protectionManager } from "./src/utils/managers/protectionManager.js";
import { startAutosendTicker } from "./src/modules/autosend.js";
import { startXsTicker } from "./src/modules/autoxs.js";

try { ffmpeg.setFfmpegPath(execSync("which ffmpeg", { encoding: "utf8" }).trim()); } catch {}
try { ffmpeg.setFfprobePath(execSync("which ffprobe", { encoding: "utf8" }).trim()); } catch {}

const loadConfig = () => JSON.parse(readFileSync("config.json", "utf-8"));

const isValidCookies = (creds) => {
    const c = creds?.cookies;
    if (!c) return false;
    if (typeof c === "string") return c.length > 50;
    return (Array.isArray(c.cookies) && c.cookies.length > 0) || (Array.isArray(c) && c.length > 0) || Object.keys(c).length > 0;
};

const C = {
    r: "\x1b[0m",
    b: "\x1b[1m",
    cyan: "\x1b[36m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    magenta: "\x1b[35m",
    gray: "\x1b[90m",
    blue: "\x1b[34m",
    white: "\x1b[37m",
    bgCyan: "\x1b[46m",
    bgGreen: "\x1b[42m",
    bgRed: "\x1b[41m",
    bgBlue: "\x1b[44m",
};

async function loginWithQR(zalo) {
    return new Promise((resolve, reject) => {
        zalo.loginQR({}, async (event) => {
            if (event.type === 0) {
                await event.actions.saveToFile("qr.png");
                qrTerminal.generate(event.data.token, { small: true }, (qr) => {
                    console.log(qr);
                });
            } else if (event.type === 1) {
                log.warn(`${C.yellow}QR expired${C.r} — retrying...`);
                event.actions.retry();
            } else if (event.type === 2) {
                log.info(`${C.green}QR scanned${C.r} — confirm on phone`);
            } else if (event.type === 3) {
                log.error(`QR declined`);
                event.actions.retry();
            }
        }).then(resolve).catch(reject);
    });
}

async function main() {
    const config = loadConfig();
    const { bot: { prefix = "!", selfListen = false } = {}, admin: { ids: adminIds = [] } = {}, credentials: creds = {} } = config;

    console.log(`${C.cyan}${C.b}┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓${C.r}`);
    console.log(`${C.cyan}${C.b}┃  ${C.yellow}✦  LAUNA  ${C.gray}(zca-js)${C.cyan}           ┃${C.r}`);
    console.log(`${C.cyan}${C.b}┃  ${C.green}✦  PROJERT BY DGK ${C.cyan}           ┃${C.r}`);
    console.log(`${C.cyan}${C.b}┃  ✦  UPDATE BY VLJNH${C.cyan}           ┃${C.r}`);
    console.log(`${C.cyan}${C.b}┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛${C.r}`);

    await rentalManager.load();
    await statsManager.load();
    autoReactManager.load();
    protectionManager.load();

    const { allCommands, moduleInfo, extraHandlers } = await loadModules();
    const { handlers: baseEventHandlers, eventCommands } = await loadEvents();
    const eventHandlers = [...baseEventHandlers, ...extraHandlers];
    Object.assign(allCommands, eventCommands);
    global.allCommands = allCommands;

    log.info(`${C.yellow}${C.b}${moduleInfo.length}${C.r} modules  ${C.green}${C.b}${Object.keys(allCommands).length}${C.r} commands  ${C.cyan}${C.b}${eventHandlers.length}${C.r} events`);

    const zalo = new Zalo({
        selfListen,
        imageMetadataGetter: async (p) => {
            try {
                const b = readFileSync(p);
                const d = sizeOf(b);
                return { width: d.width, height: d.height, size: b.length };
            } catch (e) { return { width: 100, height: 100, size: 0 }; }
        }
    });

    let api;
    if (isValidCookies(creds) && creds.imei) {
        try {
            log.info(`${C.blue}🔑 Logging in${C.r} with cookies...`);
            api = await zalo.login({ cookie: creds.cookies, imei: creds.imei, userAgent: creds.userAgent });
            log.success(`${C.green}Login OK${C.r} — cookies`);
        } catch { api = null; }
    }

    if (!api) {
        try {
            log.warn(`No valid cookies — ${C.yellow}switching to QR${C.r}`);
            api = await loginWithQR(zalo);
            log.success(`${C.green}Login OK${C.r} — QR`);
        } catch (e) { log.error(`Login failed`, e.message); process.exit(1); }
    }

    const zaloCtx = api.getContext();
    const cfg = loadConfig();
    const zpwMatch = (typeof zaloCtx.cookie === "string" ? zaloCtx.cookie : "").match(/zpw_sek=([^;]+)/);
    cfg.credentials.cookies = zpwMatch ? `zpw_sek=${zpwMatch[1].trim()}` : zaloCtx.cookie;
    cfg.credentials.imei = zaloCtx.imei;
    cfg.credentials.userAgent = zaloCtx.userAgent;
    writeFileSync("config.json", JSON.stringify(cfg, null, 2));
    log.info(`${C.gray}Credentials saved.${C.r}`);

    registerCustomApi(api, log);

    cleanTempFiles(); cleanupOldFiles();
    setInterval(() => { cleanTempFiles(); cleanupOldFiles(); }, 3600000);

    startAutosendTicker(api);
    startXsTicker(api);

    const ctx = { prefix, selfListen, adminIds, allCommands, moduleInfo, eventHandlers, log };

    // ─── Auto-reconnect WebSocket ───────────────────────────────────────────
    let retryCount    = 0;
    let isReconnecting = false;
    const MAX_RETRY_DELAY = 60000;

    async function startListener() {
        // Xóa listener cũ trước khi đăng ký mới — tránh tích lũy nhiều handler
        try { api.listener.removeAllListeners?.("error"); } catch {}
        try { api.listener.removeAllListeners?.("close"); } catch {}

        try {
            await handleListen(api, ctx);
            retryCount     = 0;
            isReconnecting = false;

            // Dùng once() để chỉ xử lý 1 lần mỗi sự kiện
            api.listener.once?.("error", (err) => {
                log.warn(`${C.yellow}[WS] Lỗi kết nối: ${err?.message || err}${C.r}`);
                scheduleReconnect();
            });
            api.listener.once?.("close", () => {
                log.warn(`${C.yellow}[WS] Kết nối đóng — sẽ reconnect...${C.r}`);
                scheduleReconnect();
            });
        } catch (e) {
            log.error(`[WS] handleListen lỗi: ${e.message}`);
            scheduleReconnect();
        }
    }

    function scheduleReconnect() {
        // Chặn nhiều reconnect đồng thời
        if (isReconnecting) return;
        isReconnecting = true;
        retryCount++;
        const delay = Math.min(5000 * retryCount, MAX_RETRY_DELAY);
        log.warn(`${C.yellow}[WS] Bị ngắt! Reconnect sau ${delay / 1000}s (lần ${retryCount})...${C.r}`);
        setTimeout(async () => {
            try { api.listener.stop?.(); } catch {}
            // Chờ thêm 2s sau khi stop để Zalo giải phóng session cũ
            await new Promise(r => setTimeout(r, 2000));
            await startListener();
        }, delay);
    }

    await startListener();

    // Không để crash khi có lỗi không xử lý
    process.on("uncaughtException", (err) => {
        log.error(`[UNCAUGHT] ${err.message}`);
    });
    process.on("unhandledRejection", (reason) => {
        log.error(`[UNHANDLED] ${reason?.message || reason}`);
    });

    const stop = () => { log.info(`${C.red}Shutting down...${C.r}`); api.listener.stop?.(); process.exit(0); };
    process.on("SIGINT", stop); process.on("SIGTERM", stop);
}

main();
