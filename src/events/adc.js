import { fs, path, axios, log } from "../globals.js";
import { pathToFileURL } from "node:url";

/**
 * Module: adc
 * Share code lên Gist hoặc cài module từ Gist/URL
 *
 * Cách dùng:
 *   .adc <lệnh>          → share code lên Gist
 *   .adc <lệnh> <url>    → cài module từ Gist/URL về bot
 */

export const name        = "adc";
export const description = "Share / cài module qua GitHub Gist";

const MODULES_DIR = path.join(process.cwd(), "src/modules");

function getToken() {
  try {
    const tk = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "tokens.json"), "utf-8"));
    return tk.githubToken || process.env.GITHUB_TOKEN || null;
  } catch { return process.env.GITHUB_TOKEN || null; }
}

// ─── Gist upload (luôn tạo mới để dễ share) ──────────────────────────────────
async function uploadGist(fileName, content, token) {
  const res = await axios.post(
    "https://api.github.com/gists",
    {
      description: `[MiZai-Bot] Module ${fileName}`,
      public:      true,
      files:       { [fileName]: { content } },
    },
    {
      headers: {
        Authorization: `token ${token}`,
        "User-Agent":  "MiZai-Bot",
        Accept:        "application/vnd.github+json",
      },
    }
  );
  const file = res.data.files[fileName];
  return { rawUrl: file.raw_url, gistUrl: res.data.html_url };
}

// ─── Resolve link → raw URL ────────────────────────────────────────────────────
async function resolveRawUrl(link) {
  // Gist page URL → lấy raw qua API
  const gistMatch = link.match(/gist\.github\.com\/[^/]+\/([a-f0-9]+)/i);
  if (gistMatch) {
    const res = await axios.get(`https://api.github.com/gists/${gistMatch[1]}`, {
      headers: { "User-Agent": "MiZai-Bot", Accept: "application/vnd.github+json" },
    });
    const jsFile = Object.values(res.data.files).find(f => f.filename.endsWith(".js"));
    if (!jsFile) throw new Error("Không tìm thấy file .js trong Gist.");
    return jsFile.raw_url;
  }
  // GitHub blob → raw
  if (link.includes("github.com") && link.includes("/blob/"))
    return link.replace("github.com", "raw.githubusercontent.com").replace("/blob/", "/");
  // Pastebin
  if (link.includes("pastebin.com") && !link.includes("/raw/"))
    return link.replace("pastebin.com/", "pastebin.com/raw/");
  // Mặc định coi là raw URL
  return link;
}

// ─── Hot reload module vào bộ nhớ ────────────────────────────────────────────
async function hotReload(filePath, allCommands) {
  const url = pathToFileURL(filePath).href + "?t=" + Date.now();
  const mod = await import(url);
  const added = [];
  if (mod.commands && typeof mod.commands === "object") {
    for (const [cmd, handler] of Object.entries(mod.commands)) {
      allCommands[cmd] = handler;
      added.push(cmd);
    }
  }
  return { modName: mod.name || path.basename(filePath, ".js"), added };
}

// ─── Export ───────────────────────────────────────────────────────────────────
export async function handle() { return false; }

export const commands = {
  adc: async (ctx) => {
    const { api, args, threadId, threadType, allCommands } = ctx;
    const send = (msg) => api.sendMessage({ msg }, threadId, threadType);

    const cmdName = (args[0] || "").trim().replace(/\.js$/, "");
    const link    = (args[1] || "").trim();

    if (!cmdName) {
      return send(
        `[ 🛠️ ADC TOOLS ]\n` +
        `─────────────────\n` +
        `📤 Share:  .adc <lệnh>\n` +
        `📥 Add:    .adc <lệnh> <gist_url>\n` +
        `─────────────────\n` +
        `💡 Cần githubToken trong tokens.json`
      );
    }

    const filePath = path.join(MODULES_DIR, `${cmdName}.js`);

    // ── Add code: cài từ Gist/URL ─────────────────────────────────────────────
    if (link) {
      try {
        await send("⏳ Đang tải module...");
        const rawUrl = await resolveRawUrl(link);
        const res    = await axios.get(rawUrl, { timeout: 30000, responseType: "text" });
        const code   = typeof res.data === "string" ? res.data : JSON.stringify(res.data);

        if (!code.includes("export const commands")) {
          return send("❌ Code không đúng format. Cần có `export const commands`.");
        }

        fs.writeFileSync(filePath, code, "utf8");
        const { modName, added } = await hotReload(filePath, allCommands);

        return send(
          `[ ✅ ĐÃ CÀI MODULE ]\n` +
          `─────────────────\n` +
          `📄 Module: ${modName}\n` +
          `📦 Lệnh:   ${added.length ? added.map(c => `.${c}`).join(", ") : `.${cmdName}`}\n` +
          `🔗 Nguồn:  ${rawUrl}\n` +
          `─────────────────`
        );
      } catch (e) {
        log.error(`[adc] Add lỗi: ${e.message}`);
        return send(`❌ Không tải được:\n${e.response?.data?.message || e.message}`);
      }
    }

    // ── Share code: upload lên Gist ───────────────────────────────────────────
    if (!fs.existsSync(filePath)) {
      return send(
        `❌ Không tìm thấy module: ${cmdName}.js\n` +
        `💡 Dùng .adc <lệnh> <url> để cài trước.`
      );
    }

    const token = getToken();
    if (!token) {
      return send(
        `❌ Chưa cấu hình githubToken.\n` +
        `📌 Thêm vào config.json:\n` +
        `"githubToken": "ghp_xxxx..."`
      );
    }

    try {
      await send("⏳ Đang upload lên GitHub Gist...");
      const code               = fs.readFileSync(filePath, "utf8");
      const { rawUrl, gistUrl } = await uploadGist(`${cmdName}.js`, code, token);

      return send(
        `[ 📤 SHARE MODULE ]\n` +
        `─────────────────\n` +
        `📄 File: ${cmdName}.js\n\n` +
        `🔗 Raw:\n${rawUrl}\n\n` +
        `🌐 Gist:\n${gistUrl}\n` +
        `─────────────────\n` +
        `💡 Cài ở bot khác:\n.adc ${cmdName} ${gistUrl}`
      );
    } catch (e) {
      log.error(`[adc] Share lỗi: ${e.message}`);
      return send(`❌ Lỗi tạo Gist:\n${e.response?.data?.message || e.message}`);
    }
  },
};
