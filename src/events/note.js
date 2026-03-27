import { fs, path, axios, log } from "../globals.js";
import { registerReaction } from "../utils/reactionRegistry.js";

/**
 * Module: note
 * Export & import code lệnh qua GitHub Gist
 *
 * Cách dùng:
 *   .note <file.js>              → upload lên Gist, thả icon để pull về
 *   .note pull <file.js>         → pull ngay từ Gist về & reload
 *   .note <file.js> <url>        → import từ URL raw về bot (thả icon để xác nhận)
 */

const MODULES_DIR   = path.join(process.cwd(), "src/modules");
const GIST_MAP_FILE = path.join(process.cwd(), "src/modules/cache/gist_ids.json");

// ─── Gist ID map ──────────────────────────────────────────────────────────────
function readGistMap() {
  try {
    if (fs.existsSync(GIST_MAP_FILE)) return JSON.parse(fs.readFileSync(GIST_MAP_FILE, "utf8"));
  } catch (_) {}
  return {};
}

function saveGistId(fileName, gistId) {
  const map = readGistMap();
  map[fileName] = gistId;
  try {
    fs.mkdirSync(path.dirname(GIST_MAP_FILE), { recursive: true });
    fs.writeFileSync(GIST_MAP_FILE, JSON.stringify(map, null, 2));
  } catch (_) {}
}

function getGistId(fileName) {
  return readGistMap()[fileName] || null;
}

// ─── Config reader ────────────────────────────────────────────────────────────
function getGithubToken() {
  try {
    const tk = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tokens.json"), "utf8"));
    return tk.githubToken || process.env.GITHUB_TOKEN || null;
  } catch {
    return process.env.GITHUB_TOKEN || null;
  }
}

// ─── GitHub Gist helpers ──────────────────────────────────────────────────────
function gistHeaders(token) {
  return {
    Authorization:  `token ${token}`,
    "Content-Type": "application/json",
    "User-Agent":   "MiZai-Bot",
  };
}

async function gistUpload(fileName, fileContent) {
  const token   = getGithubToken();
  if (!token) return null;

  const headers = gistHeaders(token);
  const gistId  = getGistId(fileName);
  const payload = {
    description: `[MiZai-Bot] ${fileName}`,
    public:      false,
    files:       { [fileName]: { content: fileContent } },
  };

  let res;
  if (gistId) {
    res = await axios.patch(`https://api.github.com/gists/${gistId}`, payload, { headers });
  } else {
    res = await axios.post("https://api.github.com/gists", payload, { headers });
    saveGistId(fileName, res.data.id);
  }

  const fileData = res.data.files?.[fileName];
  return {
    rawUrl:  fileData?.raw_url || `https://gist.githubusercontent.com/raw/${res.data.id}/${fileName}`,
    editUrl: res.data.html_url || `https://gist.github.com/${res.data.id}`,
    gistId:  res.data.id,
  };
}

async function gistPull(gistId, fileName) {
  const res = await axios.get(`https://api.github.com/gists/${gistId}`, {
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache", "User-Agent": "MiZai-Bot" },
    timeout: 15000,
  });
  const fileData = res.data.files?.[fileName];
  if (!fileData) throw new Error(`Không tìm thấy file "${fileName}" trong Gist`);
  const content = fileData.content || "";
  if (!content) {
    const rawRes = await axios.get(fileData.raw_url, {
      responseType: "text",
      headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
      timeout: 15000,
    });
    return rawRes.data;
  }
  return content;
}

// ─── Dynamic reload helper ────────────────────────────────────────────────────
async function reloadModule(filePath, allCommands) {
  try {
    const url = `${new URL(`file://${filePath}`).href}?t=${Date.now()}`;
    const mod = await import(url);
    if (mod.commands && allCommands) {
      for (const [cmd, handler] of Object.entries(mod.commands)) {
        allCommands[cmd] = handler;
      }
    }
    return mod.name || path.basename(filePath, ".js");
  } catch (err) {
    log.warn(`[note] reload thất bại: ${err.message}`);
    return null;
  }
}

// ─── Lấy msgId từ sendMessage response ───────────────────────────────────────
function extractMsgIds(resp) {
  const ids = new Set();
  const msg = resp?.message || resp?.data;
  if (!msg) return [...ids];
  const candidates = [
    msg?.msgId, msg?.globalMsgId, msg?.cliMsgId,
    msg?.data?.msgId, msg?.data?.globalMsgId, msg?.data?.cliMsgId,
  ];
  for (const id of candidates) {
    if (id) ids.add(String(id));
  }
  return [...ids];
}

// ─── Export ───────────────────────────────────────────────────────────────────
export const name        = "note";
export const description = "Export & import code lệnh qua GitHub Gist";

export async function handle() { return false; }

export const commands = {
  note: async (ctx) => {
    const { api, threadId, threadType, args, senderId, allCommands } = ctx;
    const reply = (msg) => api.sendMessage({ msg }, threadId, threadType);

    if (!args[0]) {
      return reply(
        "❌ Thiếu tên file!\n" +
        "📌 Cách dùng:\n" +
        "• .note <tên.js>        — export lên Gist\n" +
        "• .note pull <tên.js>   — pull từ Gist về\n" +
        "• .note <tên.js> <url>  — import từ URL"
      );
    }

    const token = getGithubToken();
    if (!token) {
      return reply(
        "⚠️ Chưa cấu hình githubToken!\n" +
        "Thêm vào tokens.json: \"githubToken\": \"ghp_xxx...\""
      );
    }

    // ── pull: kéo ngay từ Gist về ────────────────────────────────────────────
    if ((args[0] || "").toLowerCase() === "pull") {
      const fileName = args[1] ? (args[1].endsWith(".js") ? args[1] : `${args[1]}.js`) : null;
      if (!fileName) return reply("❌ Nhập tên file cần pull.\nVD: .note pull ping.js");

      const gistId = getGistId(fileName);
      if (!gistId) return reply(`❌ Chưa có Gist cho "${fileName}". Hãy export trước.`);

      const filePath = path.join(MODULES_DIR, fileName);
      try {
        const newCode = await gistPull(gistId, fileName);
        fs.writeFileSync(filePath, newCode, "utf8");
        await reloadModule(filePath, allCommands);

        return reply(
          `[ 📝 PULL GIST ]\n─────────────────\n` +
          `📁 ${fileName}\n` +
          `─────────────────\n✅ Đã pull & reload!`
        );
      } catch (err) {
        if (err?.response?.status === 404) {
          return reply(`❌ Gist không tồn tại. Hãy export trước.`);
        }
        return reply(`❌ Lỗi pull: ${err?.response?.data?.message || err.message}`);
      }
    }

    const fileName = args[0].endsWith(".js") ? args[0] : `${args[0]}.js`;
    const filePath = path.join(MODULES_DIR, fileName);
    const url      = args[1] && /^https?:\/\//.test(args[1]) ? args[1] : null;

    // ── Import từ URL (thả icon để xác nhận) ─────────────────────────────────
    if (url) {
      const resp = await reply(
        `[ 📝 CODE IMPORT ]\n─────────────────\n` +
        `📁 ${fileName}\n\n` +
        `🔗 Nguồn:\n${url}\n` +
        `─────────────────\n` +
        `📌 Thả cảm xúc để tải & ghi đè file`
      );

      const msgIds = extractMsgIds(resp);
      if (!msgIds.length) return;

      const importHandler = async ({ api: _api, threadId: tid, threadType: tt }) => {
        const fetchUrl = url.includes("?raw=true") ? url : `${url}?raw=true`;
        const res      = await axios.get(fetchUrl, { responseType: "text", timeout: 15000 });
        const newCode  = res.data;

        fs.writeFileSync(filePath, newCode, "utf8");
        await reloadModule(filePath, allCommands);

        let links = null;
        try { links = await gistUpload(fileName, newCode); } catch (_) {}

        await _api.sendMessage({
          msg:
            `[ 📝 CODE IMPORT ]\n─────────────────\n` +
            `📁 ${fileName}\n\n` +
            (links ? `🔗 Raw:\n${links.rawUrl}\n\n✏️ Edit:\n${links.editUrl}\n` : "") +
            `─────────────────\n✅ Đã tải, ghi đè & reload!`,
        }, tid, tt);
      };

      for (const id of msgIds) {
        registerReaction(id, {
          ttl:      5 * 60 * 1000,
          senderId: String(senderId),
          handler:  importHandler,
        });
      }
      return;
    }

    // ── Export: upload lên Gist, thả icon để pull về ──────────────────────────
    if (!fs.existsSync(filePath)) {
      return reply(`❌ Không tìm thấy file: ${fileName}`);
    }

    const fileContent = fs.readFileSync(filePath, "utf8");
    let links;
    try {
      links = await gistUpload(fileName, fileContent);
    } catch (err) {
      return reply(`❌ Upload Gist thất bại:\n${err?.response?.data?.message || err.message}`);
    }

    log.info(`[note] Đã upload ${fileName} → Gist: ${links.editUrl}`);

    const resp = await reply(
      `[ 📝 CODE EXPORT ]\n─────────────────\n` +
      `📁 ${fileName}\n\n` +
      `🔗 Raw:\n${links.rawUrl}\n\n` +
      `✏️ Edit:\n${links.editUrl}\n` +
      `─────────────────\n` +
      `📌 Chỉnh sửa xong → thả cảm xúc để lưu & reload`
    );

    const msgIds = extractMsgIds(resp);
    if (!msgIds.length) return;

    const gistId = links.gistId || getGistId(fileName);

    const pullHandler = async ({ api: _api, threadId: tid, threadType: tt }) => {
      const newCode = await gistPull(gistId, fileName);
      fs.writeFileSync(filePath, newCode, "utf8");
      await reloadModule(filePath, allCommands);

      let newLinks = null;
      try { newLinks = await gistUpload(fileName, newCode); } catch (_) {}

      const confirmResp = await _api.sendMessage({
        msg:
          `[ 📝 CODE EXPORT ]\n─────────────────\n` +
          `📁 ${fileName}\n\n` +
          `🔗 Raw:\n${(newLinks || links).rawUrl}\n\n` +
          `✏️ Edit:\n${(newLinks || links).editUrl}\n` +
          `─────────────────\n` +
          `✅ Đã lưu & reload!\n` +
          `📌 Thả cảm xúc để pull lại`,
      }, tid, tt);

      const newIds = extractMsgIds(confirmResp);
      for (const id of newIds) {
        registerReaction(id, {
          ttl:      30 * 60 * 1000,
          senderId: String(senderId),
          handler:  pullHandler,
        });
      }
    };

    for (const id of msgIds) {
      registerReaction(id, {
        ttl:      30 * 60 * 1000,
        senderId: String(senderId),
        handler:  pullHandler,
      });
    }
  },
};
