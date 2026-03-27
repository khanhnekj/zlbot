import { fs, log } from "../globals.js";

export const name = "thread";
export const description = "Tải ảnh/video từ Threads (threads.net)";

async function reply(ctx, text) {
    return ctx.api.sendMessage(
        { msg: text, quote: ctx.message?.data },
        ctx.threadId,
        ctx.threadType
    );
}

async function downloadAll(allMedia) {
    const results = [];
    for (let i = 0; i < allMedia.length; i++) {
        try {
            const { filePath, ext } = await downloadThreadsFile(allMedia[i], i);
            results.push({ filePath, ext });
        } catch (e) {
            log.warn(`[thread] Không tải được file ${i + 1}: ${e.message}`);
        }
    }
    return results;
}

function cleanupFiles(files) {
    for (const { filePath } of files) {
        try { if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
    }
}

export const commands = {

    thread: async (ctx) => {
        const { api, threadId, threadType, args } = ctx;
        const url = args[0];

        if (!url) {
            return reply(ctx,
                `[ 🧵 THREAD DOWNLOADER ]\n` +
                `─────────────────────\n` +
                ` ❯ Cách dùng: .thread <link>\n` +
                ` ❯ VD: .thread https://www.threads.net/...\n` +
                `─────────────────────\n` +
                `✨ Tải ảnh & video từ Threads!`
            );
        }

        if (!url.includes("threads.net") && !url.includes("threads.com")) {
            return reply(ctx, "⚠️ Vui lòng nhập link từ Threads (threads.net).");
        }

        await reply(ctx, "⏳ Đang lấy media từ Threads...");

        let allMedia;
        try {
            allMedia = await fetchThreadsMedia(url);
        } catch (e) {
            log.error(`[thread] Lỗi khi gọi API: ${e.message}`);
            return reply(ctx, `❌ Không thể lấy dữ liệu từ link này.\n${e.message}`);
        }

        if (!allMedia || allMedia.length === 0) {
            return reply(ctx, "❌ Không tìm thấy ảnh hoặc video nào trong bài viết này.");
        }

        const downloaded = await downloadAll(allMedia);
        if (downloaded.length === 0) {
            return reply(ctx, "❌ Tải file thất bại.");
        }

        const images = downloaded.filter(d => d.ext !== "mp4");
        const videos = downloaded.filter(d => d.ext === "mp4");

        try {
            // Gửi tất cả ảnh 1 lần
            if (images.length > 0) {
                await api.sendMessage(
                    { msg: `🖼️ ${images.length} ảnh`, attachments: images.map(d => d.filePath) },
                    threadId, threadType
                );
            }

            // Video gửi từng cái (Zalo không batch video)
            for (const vid of videos) {
                await api.sendMessage(
                    { msg: "🎬", attachments: [vid.filePath] },
                    threadId, threadType
                );
            }
        } finally {
            cleanupFiles(downloaded);
        }
    },

    thr: async (ctx) => {
        return global.allCommands?.thread?.(ctx);
    },

};
