import { fs, path } from "../globals.js";
import { drawShareBrowser, canvasAvailable } from "../utils/canvas/canvasHelper.js";

export const name = "share";
export const description = "Trình quản lý tệp tin: Duyệt thư mục và gửi tệp tin (Chỉ Admin Bot)";

const shareSessions = new Map();
const PAGE_SIZE = 20;

export const commands = {
    share: async (ctx) => {
        const { api, threadId, threadType, senderId, args, adminIds } = ctx;

        if (!adminIds.includes(String(senderId))) {
            return api.sendMessage({ msg: "⚠️ Lệnh này cực kỳ nhạy cảm và chỉ dành cho Admin Bot!" }, threadId, threadType);
        }

        let targetPath = args.join(" ").trim();
        if (!targetPath) targetPath = process.cwd();
        else if (!path.isAbsolute(targetPath)) targetPath = path.resolve(process.cwd(), targetPath);

        if (!fs.existsSync(targetPath)) {
            return api.sendMessage({ msg: "⚠️ Đường dẫn không tồn tại!" }, threadId, threadType);
        }

        const stats = fs.statSync(targetPath);
        if (stats.isFile()) {
            return sendFile(api, threadId, threadType, targetPath);
        } else {
            return listDirectory(api, threadId, threadType, senderId, targetPath, 0);
        }
    }
};

async function listDirectory(api, threadId, threadType, senderId, dirPath, page = 0) {
    try {
        const files = fs.readdirSync(dirPath);
        const folderName = path.basename(dirPath) || dirPath;

        const allItems = files.map(f => {
            const fPath = path.join(dirPath, f);
            const stat = fs.statSync(fPath);
            return { name: f, path: fPath, isDir: stat.isDirectory(), mtime: stat.mtimeMs, size: stat.size };
        });

        allItems.sort((a, b) => {
            if (a.isDir !== b.isDir) return b.isDir - a.isDir;
            return b.mtime - a.mtime;
        });

        const totalPages = Math.ceil(allItems.length / PAGE_SIZE) || 1;
        const currentPage = Math.max(0, Math.min(page, totalPages - 1));
        const pageItems = allItems.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
        const startIdx = currentPage * PAGE_SIZE;

        if (canvasAvailable && currentPage === 0) {
            try {
                const imgBuf = await drawShareBrowser(dirPath, pageItems, allItems.length);
                if (imgBuf) {
                    const tmpPath = path.join(process.cwd(), `share_canvas_${Date.now()}.png`);
                    fs.writeFileSync(tmpPath, imgBuf);
                    await api.sendMessage({
                        msg: `📂 ${folderName.toUpperCase()}`,
                        attachments: [tmpPath]
                    }, threadId, threadType);
                    fs.unlinkSync(tmpPath);

                    const key = `${threadId}-${senderId}`;
                    shareSessions.set(key, { currentPath: dirPath, allItems, page: currentPage });
                    return;
                }
            } catch (e) { }
        }

        // Text mode với phân trang
        let msg = `📂 [ ${folderName.toUpperCase()} ] — Trang ${currentPage + 1}/${totalPages}\n`;
        msg += `─────────────────\n`;
        if (currentPage > 0) msg += `📁 .. (Thư mục cha — gõ "up")\n`;
        else msg += `📁 .. (Thư mục cha — gõ "up")\n`;

        pageItems.forEach((item, index) => {
            const globalIdx = startIdx + index + 1;
            const size = item.isDir ? "" : ` (${(item.size / 1024).toFixed(1)}KB)`;
            msg += `${globalIdx}. ${item.isDir ? "📁" : "📄"} ${item.name}${size}\n`;
        });

        msg += `─────────────────\n`;
        msg += `📊 Tổng: ${allItems.length} mục | Trang ${currentPage + 1}/${totalPages}\n`;
        msg += `💡 Nhập STT để Mở/Gửi | "up" = thư mục cha\n`;
        if (totalPages > 1) {
            msg += `📄 "next"/"n" = trang sau | "prev"/"p" = trang trước\n`;
            msg += `📄 "page N" = nhảy tới trang N\n`;
        }
        msg += `📌 ${dirPath}`;

        const sent = await api.sendMessage({ msg }, threadId, threadType);
        const key = `${threadId}-${senderId}`;
        shareSessions.set(key, {
            currentPath: dirPath,
            allItems,
            page: currentPage,
            messageId: sent?.messageId || sent?.globalMsgId
        });
    } catch (e) {
        api.sendMessage({ msg: `⚠️ Lỗi: ${e.message}` }, threadId, threadType);
    }
}

async function sendFile(api, threadId, threadType, filePath) {
    try {
        const fileName = path.basename(filePath);
        const stats = fs.statSync(filePath);
        const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);

        if (stats.size > 100 * 1024 * 1024) {
            return api.sendMessage({ msg: `⚠️ File quá lớn (${fileSizeMB}MB). Zalo chỉ hỗ trợ tối đa 100MB qua Bot.` }, threadId, threadType);
        }

        await api.sendMessage({ msg: `⏳ Đang gửi file: ${fileName} (${fileSizeMB}MB)...` }, threadId, threadType);

        await api.sendMessage({
            msg: `📄 File: ${fileName}`,
            attachments: [filePath]
        }, threadId, threadType);

    } catch (e) {
        api.sendMessage({ msg: `⚠️ Lỗi gửi file: ${e.message}` }, threadId, threadType);
    }
}

export async function handle(ctx) {
    const { api, threadId, threadType, senderId, content } = ctx;
    const key = `${threadId}-${senderId}`;
    const session = shareSessions.get(key);
    if (!session) return false;

    const input = content.trim().toLowerCase();
    const { currentPath, allItems, page } = session;
    const totalPages = Math.ceil(allItems.length / PAGE_SIZE) || 1;

    // Lên thư mục cha
    if (input === "up" || input === "0") {
        const parentPath = path.dirname(currentPath);
        shareSessions.delete(key);
        await listDirectory(api, threadId, threadType, senderId, parentPath, 0);
        return true;
    }

    // Trang tiếp theo
    if (input === "next" || input === "n") {
        if (page + 1 >= totalPages) {
            await api.sendMessage({ msg: `⚠️ Đây là trang cuối (${totalPages}/${totalPages}).` }, threadId, threadType);
        } else {
            await listDirectory(api, threadId, threadType, senderId, currentPath, page + 1);
        }
        return true;
    }

    // Trang trước
    if (input === "prev" || input === "p") {
        if (page <= 0) {
            await api.sendMessage({ msg: "⚠️ Đây là trang đầu tiên." }, threadId, threadType);
        } else {
            await listDirectory(api, threadId, threadType, senderId, currentPath, page - 1);
        }
        return true;
    }

    // Nhảy tới trang N: "page 3"
    const pageMatch = input.match(/^(?:page|trang)\s+(\d+)$/);
    if (pageMatch) {
        const targetPage = parseInt(pageMatch[1]) - 1;
        if (targetPage < 0 || targetPage >= totalPages) {
            await api.sendMessage({ msg: `⚠️ Trang không hợp lệ. Chọn từ 1 đến ${totalPages}.` }, threadId, threadType);
        } else {
            await listDirectory(api, threadId, threadType, senderId, currentPath, targetPage);
        }
        return true;
    }

    // Chọn mục theo STT (STT toàn cục)
    const choice = parseInt(input);
    if (isNaN(choice) || choice < 1 || choice > allItems.length) return false;

    const selected = allItems[choice - 1];
    shareSessions.delete(key);

    if (selected.isDir) {
        await listDirectory(api, threadId, threadType, senderId, selected.path, 0);
    } else {
        await sendFile(api, threadId, threadType, selected.path);
    }

    return true;
}
