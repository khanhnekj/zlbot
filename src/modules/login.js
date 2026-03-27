import { fs, path, log } from "../globals.js";
import { Zalo } from "../api-zalo/index.js";
import sizeOf from "image-size";

/**
 * Module: login
 * Đăng nhập Zalo qua QR, đổi/lưu/chạy đồng thời nhiều tài khoản
 * Credits: MiZai
 */

const ACCOUNTS_DIR  = path.join(process.cwd(), "includes", "accounts");
const QR_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_QR        = 3;

function ensureAccountsDir() {
  if (!fs.existsSync(ACCOUNTS_DIR)) fs.mkdirSync(ACCOUNTS_DIR, { recursive: true });
}

function listAccounts() {
  ensureAccountsDir();
  return fs.readdirSync(ACCOUNTS_DIR)
    .filter(f => f.endsWith(".json"))
    .map(f => {
      const cookiePath = path.join(ACCOUNTS_DIR, f);
      const name       = f.replace(".json", "");
      let active       = false;
      try {
        const meta = JSON.parse(fs.readFileSync(cookiePath, "utf8"));
        active = meta._active === true;
      } catch (_) {}
      return { name, active, cookiePath };
    });
}

function setActiveMeta(cookiePath, active) {
  try {
    const data = JSON.parse(fs.readFileSync(cookiePath, "utf8"));
    data._active = active;
    fs.writeFileSync(cookiePath, JSON.stringify(data, null, 2), "utf8");
  } catch (_) {}
}

function cleanCookies(raw) {
  const arr = Array.isArray(raw) ? raw : (raw?.cookies || []);
  return arr.map(c => ({
    key:      c.key || c.name || "",
    value:    String(c.value ?? ""),
    domain:   c.domain   || ".zalo.me",
    path:     c.path     || "/",
    secure:   c.secure   ?? true,
    httpOnly: c.httpOnly ?? true,
  })).filter(c => c.key && c.value);
}

function cookieToString(cleaned) {
  return cleaned.map(c => `${c.key}=${c.value}`).join("; ");
}

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(path.join(process.cwd(), "config.json"), "utf8")); } catch { return {}; }
}

// ─── Export ───────────────────────────────────────────────────────────────────
export const name        = "login";
export const description = "Đăng nhập Zalo qua QR, đổi/lưu/chạy đồng thời nhiều tài khoản";

export const commands = {
  login: async (ctx) => {
    const { api, threadId, threadType, args } = ctx;
    const reply = (msg) => api.sendMessage({ msg }, threadId, threadType);

    const sub  = (args[0] || "").toLowerCase().trim();
    const name = (args[1] || "").trim().replace(/[^a-zA-Z0-9_\-]/g, "");

    ensureAccountsDir();

    // ── list ────────────────────────────────────────────────────────────────
    if (sub === "list") {
      const accounts = listAccounts();
      if (!accounts.length) {
        return reply(
          `📭 Chưa có tài khoản nào được lưu.\n` +
          `💡 Dùng: login save <tên>  để đăng nhập và lưu.`
        );
      }
      const lines = accounts.map((a, i) =>
        `  ${i + 1}. ${a.name}  ${a.active ? "🟢 đang chạy" : "⚫ không chạy"}`
      );
      return reply(
        `📋 Danh sách tài khoản (${accounts.length}):\n` +
        lines.join("\n") + "\n\n" +
        `🟢 Bật đồng thời: login active <tên>\n` +
        `⚫ Tắt:           login inactive <tên>\n` +
        `🔀 Chuyển chính:  login use <tên>`
      );
    }

    // ── del ─────────────────────────────────────────────────────────────────
    if (sub === "del" || sub === "delete") {
      if (!name) return reply("❌ Nhập tên tài khoản cần xóa.\nVí dụ: login del acc1");
      const filePath = path.join(ACCOUNTS_DIR, `${name}.json`);
      if (!fs.existsSync(filePath)) return reply(`❌ Không tìm thấy tài khoản "${name}".`);
      fs.unlinkSync(filePath);
      return reply(`🗑️ Đã xóa tài khoản "${name}" thành công.`);
    }

    // ── use / switch ─────────────────────────────────────────────────────────
    if (sub === "use" || sub === "switch") {
      if (!name) return reply("❌ Nhập tên tài khoản muốn dùng.\nVí dụ: login use acc1");
      const filePath = path.join(ACCOUNTS_DIR, `${name}.json`);
      if (!fs.existsSync(filePath)) return reply(`❌ Không tìm thấy tài khoản "${name}".`);
      const cfg        = loadConfig();
      const cookiePath = path.join(process.cwd(), cfg.cookiePath || "./cookie.json");
      fs.copyFileSync(filePath, cookiePath);
      await reply(`✅ Đã chuyển sang tài khoản "${name}"!\n🔄 Bot đang restart...`);
      setTimeout(() => global.restartBot?.(`Chuyển tài khoản → ${name}`, 2000), 500);
      return;
    }

    // ── active ───────────────────────────────────────────────────────────────
    if (sub === "active") {
      if (!name) return reply("❌ Nhập tên tài khoản muốn bật.\nVí dụ: login active acc1");
      const filePath = path.join(ACCOUNTS_DIR, `${name}.json`);
      if (!fs.existsSync(filePath)) return reply(`❌ Không tìm thấy tài khoản "${name}".`);
      setActiveMeta(filePath, true);
      return reply(`🟢 Đã đánh dấu tài khoản "${name}" là đang chạy.`);
    }

    // ── inactive ─────────────────────────────────────────────────────────────
    if (sub === "inactive") {
      if (!name) return reply("❌ Nhập tên tài khoản muốn tắt.\nVí dụ: login inactive acc1");
      const filePath = path.join(ACCOUNTS_DIR, `${name}.json`);
      if (!fs.existsSync(filePath)) return reply(`❌ Không tìm thấy tài khoản "${name}".`);
      setActiveMeta(filePath, false);
      return reply(`⚫ Đã tắt tài khoản "${name}" khỏi chế độ đồng thời.`);
    }

    // ── login / login save ────────────────────────────────────────────────────
    if (sub === "save" && !name) return reply("❌ Nhập tên tài khoản muốn lưu.\nVí dụ: login save acc1");

    const saveName   = (sub === "save" && name) ? name : null;
    const cfg        = loadConfig();
    const userAgent  = (cfg.credentials?.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64)").trim();
    const qrPath     = path.join(process.cwd(), "qr.png");
    const cookiePath = path.join(process.cwd(), cfg.cookiePath || "./cookie.json");

    await reply(
      `🔐 Đang tạo mã QR đăng nhập Zalo...\n` +
      `⏳ Vui lòng chờ trong giây lát.`
    );

    let loginDone = false;
    let qrCount   = 0;

    const timer = setTimeout(async () => {
      if (!loginDone) {
        await reply("⏰ Hết thời gian chờ QR (5 phút). Vui lòng thử lại.").catch(() => {});
      }
    }, QR_TIMEOUT_MS);

    try {
      const zalo = new Zalo({
        selfListen:  true,
        checkUpdate: false,
        logging:     false,
        imageMetadataGetter: async (fp) => {
          const buf  = await fs.promises.readFile(fp);
          const dim  = sizeOf(buf);
          const stat = await fs.promises.stat(fp);
          return { width: dim?.width, height: dim?.height, size: stat?.size ?? buf.length };
        },
      });

      zalo.loginQR({ userAgent, qrPath }, async (qrEvent) => {
        const { type, data, actions } = qrEvent;

        if (type === 0) {
          qrCount++;
          await actions.saveToFile(qrPath);
          try {
            await api.sendMessage(
              {
                msg:
                  `📱 Quét mã QR để đăng nhập Zalo` +
                  (saveName ? ` (lưu thành "${saveName}")` : "") +
                  (qrCount > 1 ? ` (lần ${qrCount}/${MAX_QR})` : "") + `:\n` +
                  `📌 Zalo → Cá nhân → Đăng nhập thiết bị khác → Quét mã\n` +
                  `⏱️ Mã hết hạn sau ~60 giây`,
                attachments: [qrPath],
              },
              threadId,
              threadType
            );
          } catch (_) {}

        } else if (type === 1) {
          if (qrCount >= MAX_QR) {
            clearTimeout(timer); loginDone = true;
            await reply(`❌ Đã tạo QR ${MAX_QR} lần nhưng không được quét. Vui lòng thử lại.`).catch(() => {});
            actions.abort?.(); return;
          }
          actions.retry();
          await reply(`🔄 Mã QR đã hết hạn, đang tạo mã mới... (${qrCount}/${MAX_QR})`).catch(() => {});

        } else if (type === 2) {
          await reply("✅ Đã quét mã QR!\n📲 Vui lòng xác nhận trên điện thoại...").catch(() => {});

        } else if (type === 3) {
          if (qrCount >= MAX_QR) {
            clearTimeout(timer); loginDone = true;
            await reply(`❌ Đăng nhập bị từ chối ${MAX_QR} lần. Vui lòng thử lại.`).catch(() => {});
            actions.abort?.(); return;
          }
          await reply("❌ Đăng nhập bị từ chối. Đang thử lại...").catch(() => {});
          actions.retry();

        } else if (type === 4) {
          clearTimeout(timer);
          loginDone = true;

          if (data?.cookie) {
            const cleaned   = cleanCookies(data.cookie);
            const cookieStr = cookieToString(cleaned);

            if (saveName) {
              const savePath = path.join(ACCOUNTS_DIR, `${saveName}.json`);
              fs.writeFileSync(savePath, JSON.stringify({ cookie: cookieStr, _active: false }, null, 2), "utf-8");
            }

            fs.writeFileSync(cookiePath, JSON.stringify(cookieStr, null, 2), "utf-8");

            const msg = saveName
              ? `✅ Đăng nhập thành công!\n💾 Đã lưu tài khoản "${saveName}".\n🔄 Bot đang restart...`
              : `✅ Đăng nhập thành công!\n🔄 Bot đang restart với tài khoản mới...`;

            await reply(msg).catch(() => {});
            setTimeout(() => global.restartBot?.("Đổi tài khoản qua lệnh login", 2000), 500);
          }
        }
      }).catch(async (err) => {
        clearTimeout(timer);
        if (!loginDone) await reply(`❌ Lỗi đăng nhập: ${err?.message || err}`).catch(() => {});
      });
    } catch (err) {
      clearTimeout(timer);
      await reply(`❌ Lỗi khởi tạo: ${err?.message || err}`).catch(() => {});
    }
  },
};
