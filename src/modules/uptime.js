import { fs, path, log } from "../globals.js";
import os from "node:os";

/**
 * Module: uptime / ping
 * Xem thời gian hoạt động, ping, tài nguyên và thông tin hệ thống
 * Credits: MiZai
 */

const STATS_FILE = path.join(process.cwd(), "src/modules/cache/bot_stats.json");

// ─── Restart counter ──────────────────────────────────────────────────────────
function loadStats() {
  try {
    if (fs.existsSync(STATS_FILE)) return JSON.parse(fs.readFileSync(STATS_FILE, "utf8"));
  } catch (_) {}
  return { restartCount: 0, firstStart: Date.now() };
}

function saveStats(stats) {
  try {
    fs.mkdirSync(path.dirname(STATS_FILE), { recursive: true });
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
  } catch (_) {}
}

const _botStats = loadStats();
_botStats.restartCount = (_botStats.restartCount || 0) + 1;
if (!_botStats.firstStart) _botStats.firstStart = Date.now();
saveStats(_botStats);

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getLocalIP() {
  try {
    const ifaces = os.networkInterfaces();
    for (const list of Object.values(ifaces)) {
      for (const iface of list) {
        if (iface.family === "IPv4" && !iface.internal) return iface.address;
      }
    }
  } catch (_) {}
  return "127.0.0.1";
}

async function getSystemData(pingMs) {
  const uptime = process.uptime();
  const d      = Math.floor(uptime / 86400);
  const h      = Math.floor((uptime % 86400) / 3600);
  const m      = Math.floor((uptime % 3600) / 60);
  const s      = Math.floor(uptime % 60);
  const pad    = n => String(n).padStart(2, "0");

  const uptimeStr = d > 0
    ? `${d}d ${pad(h)}h ${pad(m)}m ${pad(s)}s`
    : `${pad(h)}h ${pad(m)}m ${pad(s)}s`;

  const totalMem = os.totalmem() / (1024 * 1024);
  const freeMem  = os.freemem()  / (1024 * 1024);
  const usedMem  = totalMem - freeMem;
  const ramPct   = Math.round((usedMem / totalMem) * 100);
  const cpuLoad  = os.loadavg()[0];
  const cpuCount = os.cpus().length;
  const cpuPct   = Math.min(100, Math.round((cpuLoad / cpuCount) * 100));
  const cpuModel = os.cpus()[0]?.model?.split(" ").slice(0, 4).join(" ") || "Unknown";

  const vnTime    = new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false });
  const startTime = new Date(Date.now() - uptime * 1000)
    .toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false });

  const stats = loadStats();

  return {
    uptimeStr, startTime, vnTime,
    ramPct, cpuPct, cpuModel,
    usedMem:      usedMem.toFixed(0),
    totalMem:     totalMem.toFixed(0),
    freeMem,
    nodeVer:      process.version,
    cmdCount:     Object.keys(global.allCommands || {}).length,
    prefix:       global.prefix || global.config?.bot?.prefix || ".",
    pingMs:       pingMs ?? 0,
    ramWarning:   ramPct >= 85,
    hostname:     os.hostname(),
    localIP:      getLocalIP(),
    platform:     `${os.type()} ${os.arch()}`,
    restartCount: stats.restartCount || 1,
    firstStart:   stats.firstStart
      ? new Date(stats.firstStart).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false })
      : vnTime,
  };
}

// ─── Export ───────────────────────────────────────────────────────────────────
export const name        = "uptime";
export const description = "Xem thời gian hoạt động, ping, tài nguyên và thông tin hệ thống";

export const commands = {
  uptime: async (ctx) => {
    const { api, threadId, threadType } = ctx;
    const reply = (msg) => api.sendMessage({ msg }, threadId, threadType);

    const t0 = Date.now();
    await reply("⏳ Đang tải thông tin hệ thống...");
    const pingMs = Date.now() - t0;

    const data = await getSystemData(pingMs);

    if (data.ramWarning) {
      await reply(`⚠️ CẢNH BÁO: RAM đang ở mức cao (${data.ramPct}%)! Cân nhắc restart bot.`);
    }

    const cacheDir = path.join(process.cwd(), "src/modules/cache");
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

    const imgPath = path.join(cacheDir, `uptime-${Date.now()}.png`);
    try {
      const buffer = await drawUptimeCard(data);
      fs.writeFileSync(imgPath, buffer);

      const remoteUrl = await uploadToTmpFiles(imgPath, api, threadId, threadType);
      const statusMsg =
        `[ ⚡ SYSTEM UPTIME ]\n` +
        `─────────────────\n` +
        `⏳ ${data.uptimeStr}  |  🏓 ${data.pingMs}ms  |  📦 ${data.cmdCount} lệnh\n` +
        `💾 RAM: ${data.usedMem}MB/${data.totalMem}MB (${data.ramPct}%)${data.ramWarning ? "  ⚠️" : ""}\n` +
        `🔩 CPU: ${data.cpuPct}%  |  🔧 ${data.nodeVer}`;

      if (remoteUrl && api.sendImageEnhanced) {
        await api.sendImageEnhanced({ imageUrl: remoteUrl, threadId, threadType, width: 1100, height: 500, msg: statusMsg });
      } else {
        await api.sendMessage({ msg: statusMsg, attachments: [imgPath] }, threadId, threadType);
      }
    } catch (e) {
      log.error("[uptime] Canvas lỗi:", e.message);
      await reply(
        `⚡ SYSTEM UPTIME — v2.0.0\n` +
        `${"─".repeat(36)}\n` +
        `⏰ ${data.vnTime}\n` +
        `⏳ ${data.uptimeStr}\n` +
        `🏓 ${data.pingMs}ms  |  📦 ${data.cmdCount} lệnh\n` +
        `💾 RAM: ${data.usedMem}MB/${data.totalMem}MB (${data.ramPct}%)\n` +
        `🔩 CPU: ${data.cpuPct}%  |  🔧 ${data.nodeVer}`
      );
    } finally {
      if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    }
  },
};
