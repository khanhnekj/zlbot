/**
 * Module: Run Code
 * Chạy code nhiều ngôn ngữ ngay trong Zalo qua Piston API
 *
 * Cách dùng:
 *   !run <ngôn ngữ> <code>
 *   !run js console.log("Hello!")
 *   !run python print("Xin chào!")
 *
 *   Hoặc dùng code block (nhiều dòng):
 *   !run python
 *   ```
 *   for i in range(5):
 *       print(i)
 *   ```
 */

import { axios } from "../globals.js";

export const name = "run";
export const description = "Chạy code nhiều ngôn ngữ (JS, Python, C++, Java, Bash,...) ngay trong Zalo";

const PISTON_API = "https://emkc.org/api/v2/piston/execute";
const TIMEOUT_MS = 10000;
const MAX_OUTPUT = 1500;

// Bản đồ alias ngôn ngữ → tên Piston
const LANG_MAP = {
    js:         { language: "javascript", version: "*" },
    javascript: { language: "javascript", version: "*" },
    node:       { language: "javascript", version: "*" },
    ts:         { language: "typescript", version: "*" },
    typescript: { language: "typescript", version: "*" },
    py:         { language: "python",     version: "*" },
    python:     { language: "python",     version: "*" },
    python3:    { language: "python",     version: "*" },
    bash:       { language: "bash",       version: "*" },
    sh:         { language: "bash",       version: "*" },
    c:          { language: "c",          version: "*" },
    cpp:        { language: "c++",        version: "*" },
    "c++":      { language: "c++",        version: "*" },
    java:       { language: "java",       version: "*" },
    rs:         { language: "rust",       version: "*" },
    rust:       { language: "rust",       version: "*" },
    go:         { language: "go",         version: "*" },
    golang:     { language: "go",         version: "*" },
    rb:         { language: "ruby",       version: "*" },
    ruby:       { language: "ruby",       version: "*" },
    php:        { language: "php",        version: "*" },
    lua:        { language: "lua",        version: "*" },
    cs:         { language: "csharp",     version: "*" },
    csharp:     { language: "csharp",     version: "*" },
    kt:         { language: "kotlin",     version: "*" },
    kotlin:     { language: "kotlin",     version: "*" },
    swift:      { language: "swift",      version: "*" },
    r:          { language: "r",          version: "*" },
    perl:       { language: "perl",       version: "*" },
};

// Icon cho từng ngôn ngữ
const LANG_ICON = {
    javascript: "🟨", typescript: "🔷", python: "🐍",
    bash: "🖥️", c: "⚙️", "c++": "⚙️", java: "☕",
    rust: "🦀", go: "🐹", ruby: "💎", php: "🐘",
    lua: "🌙", csharp: "💠", kotlin: "🎯", swift: "🍎",
    r: "📊", perl: "🐪",
};

// Trích xuất code từ code block markdown: ```lang\ncode\n```
function extractCodeBlock(text) {
    const match = text.match(/```[\w]*\n?([\s\S]*?)```/);
    if (match) return match[1].trim();
    return null;
}

async function runCode(language, version, code) {
    const res = await axios.post(
        PISTON_API,
        {
            language,
            version,
            files: [{ content: code }],
        },
        { timeout: TIMEOUT_MS }
    );
    return res.data;
}

function formatOutput(result, langDisplay) {
    const run = result.run || {};
    const stdout = (run.stdout || "").trim();
    const stderr = (run.stderr || "").trim();
    const compile = result.compile || {};
    const compileErr = (compile.stderr || "").trim();
    const compileOut = (compile.stdout || "").trim();

    let output = "";

    if (compileErr) {
        output = `❌ Lỗi biên dịch:\n${compileErr}`;
    } else if (stderr) {
        output = stdout
            ? `📤 Output:\n${stdout}\n\n⚠️ Stderr:\n${stderr}`
            : `❌ Lỗi:\n${stderr}`;
    } else if (stdout) {
        output = stdout;
    } else if (compileOut) {
        output = compileOut;
    } else {
        output = "(Không có output)";
    }

    // Cắt nếu quá dài
    if (output.length > MAX_OUTPUT) {
        output = output.slice(0, MAX_OUTPUT) + `\n... [Đã cắt bớt]`;
    }

    const icon = LANG_ICON[langDisplay] || "💻";
    const exitCode = run.code ?? "?";
    const header = `${icon} [${langDisplay.toUpperCase()}] • exit: ${exitCode}`;
    const divider = "─────────────────";

    return `${header}\n${divider}\n${output}\n${divider}`;
}

export const commands = {
    run: async (ctx) => {
        const { api, threadId, threadType, args, message } = ctx;

        if (args.length === 0) {
            return api.sendMessage({
                msg:
                    `💻 Hướng dẫn dùng lệnh !run:\n` +
                    `─────────────────\n` +
                    `!run <ngôn ngữ> <code>\n\n` +
                    `Ví dụ:\n` +
                    `  !run js console.log("Hello!")\n` +
                    `  !run python print("Xin chào!")\n` +
                    `  !run bash echo $(date)\n\n` +
                    `🌐 Ngôn ngữ hỗ trợ:\n` +
                    `js, python, bash, c, cpp, java, rust, go, ruby, php, lua, ts, csharp, kotlin, swift, r, perl`,
            }, threadId, threadType);
        }

        const langAlias = args[0].toLowerCase();
        const langInfo = LANG_MAP[langAlias];

        if (!langInfo) {
            return api.sendMessage({
                msg: `❓ Không hỗ trợ ngôn ngữ: "${args[0]}"\n\nDanh sách hỗ trợ:\njs, python, bash, c, cpp, java, rust, go, ruby, php, lua, ts, csharp, kotlin, swift, r, perl`,
            }, threadId, threadType);
        }

        // Lấy phần code sau tên ngôn ngữ
        let rawCode = args.slice(1).join(" ").trim();

        // Thử trích xuất từ code block markdown
        const fromBlock = extractCodeBlock(rawCode);
        if (fromBlock) rawCode = fromBlock;

        // Nếu không có code inline, thử lấy từ tin nhắn quote
        if (!rawCode) {
            const quoteContent = message?.data?.quote?.content;
            if (quoteContent) {
                rawCode = typeof quoteContent === "string"
                    ? quoteContent
                    : (quoteContent.text || quoteContent.desc || "");
                const fromQuoteBlock = extractCodeBlock(rawCode);
                if (fromQuoteBlock) rawCode = fromQuoteBlock;
            }
        }

        if (!rawCode) {
            return api.sendMessage({
                msg: `❓ Vui lòng nhập code sau tên ngôn ngữ.\nVí dụ: !run ${langAlias} console.log("Hello!")`,
            }, threadId, threadType);
        }

        // Gửi thông báo đang chạy
        await api.sendMessage({ msg: `⏳ Đang chạy code ${langAlias.toUpperCase()}...` }, threadId, threadType);

        try {
            const result = await runCode(langInfo.language, langInfo.version, rawCode);
            const output = formatOutput(result, langInfo.language);
            await api.sendMessage({ msg: output }, threadId, threadType);
        } catch (e) {
            const errMsg = e.response?.data?.message || e.message;
            await api.sendMessage({
                msg: `❌ Lỗi thực thi:\n${errMsg}`,
            }, threadId, threadType);
        }
    },

    // Alias ngắn
    code: async (ctx) => {
        return commands.run(ctx);
    },

    exec: async (ctx) => {
        return commands.run(ctx);
    },
};
