import { ThreadType } from "zca-js";
import fs from "node:fs";
import path from "node:path";
import { statsManager } from "./managers/statsManager.js";
import { rentalManager } from "./managers/rentalManager.js";
import { prefixManager } from "./managers/prefixManager.js";
import { messageCache } from "./core/messageCache.js";
import { cooldownManager } from "./managers/cooldownManager.js";
import { groupAdminManager } from "./managers/groupAdminManager.js";
import { threadSettingsManager } from "./managers/threadSettingsManager.js";

function levenshteinDistance(s1, s2) {
    const m = s1.length, n = s2.length;
    const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
        }
    }
    return dp[m][n];
}

export async function handleListen(api, ctx_base) {
    const { prefix, selfListen, adminIds, allCommands, eventHandlers, log } = ctx_base;
    
    const getConfig = () => JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "config.json"), "utf-8"));

    const boxNameCache = new Map();
    const BOX_CACHE_TTL = 30 * 60 * 1000; // 30 phút
    const ownId = api.getOwnId();

    // Dọn boxNameCache theo TTL mỗi 15 phút
    setInterval(() => {
        const now = Date.now();
        for (const [key, val] of boxNameCache.entries()) {
            if (now - val.ts > BOX_CACHE_TTL) boxNameCache.delete(key);
        }
    }, 15 * 60 * 1000);

    const fetchBoxName = async (threadId) => {
        const cached = boxNameCache.get(threadId);
        if (cached && Date.now() - cached.ts < BOX_CACHE_TTL) return cached.name;
        try {
            const groupRes = await api.getGroupInfo(threadId).catch(() => null);
            const info = groupRes?.[threadId] || groupRes?.gridInfoMap?.[threadId] || groupRes;
            const bName = info?.gName || info?.gname || info?.name || info?.title || "Nhóm";
            if (boxNameCache.size > 200) {
                const oldest = [...boxNameCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
                if (oldest) boxNameCache.delete(oldest[0]);
            }
            boxNameCache.set(threadId, { name: bName, ts: Date.now() });
            return bName;
        } catch { return "Nhóm"; }
    };

    const listener = api.listener;

    listener.on("message", async (message) => {
        let ctx = null; // Khởi tạo để dễ dàng gán null sau này
        try {
            let { data, type, threadId, isSelf } = message;
            if (isSelf && !selfListen) return;

            const senderId = String(data.uidFrom ?? data.uid ?? "");
            const senderName = data.dName ?? senderId;

            // --- CACHE TIN NHẮN (TIẾT KIỆM RAM) ---
            const cacheData = {
                content: typeof data.content === "string" ? data.content
                    : (data.content?.text || data.content?.desc || data.content?.title || data.content?.href || null),
                senderName, senderId, threadId, type,
                msgId: data.msgId, cliMsgId: data.cliMsgId, globalMsgId: data.globalMsgId,
                data
            };
            if (data.msgId)       messageCache.set(data.msgId,       cacheData);
            if (data.cliMsgId)    messageCache.set(data.cliMsgId,    cacheData);
            if (data.globalMsgId) messageCache.set(data.globalMsgId, cacheData);

            let content = null;
            if (typeof data.content === "string") {
                content = data.content.trim();
            } else if (typeof data.content === "object" && data.content !== null) {
                content = data.content.text || data.content.desc || data.content.title || data.content.href || null;
            }

            const isGroup = type === ThreadType.Group;
            const currentPrefix = (prefixManager.getPrefix(threadId) || prefix).trim();
            const groupName = isGroup ? await fetchBoxName(threadId) : null;

            const isOwner = adminIds.includes(String(senderId));
            const isRented = rentalManager.isRented(threadId);

            // --- XỬ LÝ MENTION Ở ĐẦU (REPLY) --- (cần trước cả rental gate)
            let processedContent = content || "";
            if (data.mentions?.length > 0) {
                const sortedMentions = [...data.mentions].sort((a, b) => a.pos - b.pos);
                let lastTagEnd = 0;
                for (const m of sortedMentions) {
                    if (processedContent.slice(lastTagEnd, m.pos).trim() === "") {
                        lastTagEnd = m.pos + m.len;
                    } else break;
                }
                processedContent = processedContent.slice(lastTagEnd).trim();
            }

            // --- CHẠY EVENTS CÓ alwaysRun=true TRƯỚC RENTAL GATE (vd: protection) ---
            if (isGroup && !isSelf) {
                const baseCtx = { ...ctx_base, api, message, content: processedContent, isGroup, threadId, threadType: type, senderId, senderName, isSelf };
                for (const evt of eventHandlers) {
                    if (!evt.alwaysRun) continue;
                    try {
                        if (typeof evt.handle === "function") {
                            if (await evt.handle(baseCtx)) return;
                        }
                    } catch (e) { log.error(`Lỗi event alwaysRun [${evt.name}]:`, e.message); }
                }
            }

            // --- HỆ THỐNG ADMIN ONLY (PER-THREAD) & ROLE CHECK ---
            if (isGroup) {
                const groupAdmins = await groupAdminManager.fetchGroupAdmins(api, threadId);
                const isBoxAdmin = groupAdmins.includes(String(senderId));
                const isAdminOnly = threadSettingsManager.isAdminOnly(threadId);

                // --- GHI THỐNG KÊ TƯƠNG TÁC ---
                if (!isSelf && senderId) {
                    const role = isOwner ? "Admin" : (isBoxAdmin ? "Admin" : null);
                    statsManager.addMessage(threadId, senderId, senderName, role);
                }

                if (!isOwner) {
                    if (!isRented) return; // Nhóm chưa thuê = block commands

                    if (isAdminOnly && !isBoxAdmin) {
                        if (content?.startsWith(currentPrefix)) {
                            const tagName = `@${senderName}`;
                            const msg = `🔒 @tag ─ Nhóm đang ở chế độ [ADMIN ONLY].\nChỉ Quản trị viên mới dùng được Bot lúc này.`;
                            const mentions = [{ uid: String(senderId), pos: 3, len: tagName.length }];
                            await api.sendMessage({ msg, mentions, quote: data }, threadId, type).catch(() => {});
                        }
                        return;
                    }
                }
            } else {
                // Chat riêng: có thể thêm logic nếu cần, hiện tại không block
            }

            ctx = { ...ctx_base, api, message, content, isGroup, threadId, threadType: type, senderId, senderName, isSelf };
            
            // --- HÀM REPLY SIÊU CẤP ---
            ctx.reply = async (msgObj, targetUids = [], opts = {}) => {
                let text = typeof msgObj === "string" ? msgObj : (msgObj.msg || "");
                const attachments = msgObj.attachments || [];
                const hidden = opts.hidden ?? msgObj.hidden ?? false;
                const quote = message.data?.quote || message.data?.content?.quote || message.data;
                if (targetUids.length === 0) {
                    const qId = String(quote?.uidFrom || quote?.ownerId || "");
                    if (qId) targetUids = [qId];
                }
                let mentions = [];
                if (hidden) {
                    // Tag ẩn: mention với len=0 — ping nhưng không hiện @tên
                    targetUids.forEach(uid => mentions.push({ uid: String(uid), pos: text.length, len: 0 }));
                } else {
                    let count = 0;
                    while (text.includes("@tag") && count < targetUids.length) {
                        const tagName = " @Thành viên ";
                        const pos = text.indexOf("@tag");
                        text = text.replace("@tag", tagName);
                        mentions.push({ uid: String(targetUids[count]), pos: pos + 1, len: tagName.trim().length });
                        count++;
                    }
                }
                return api.sendMessage({ msg: text, attachments, quote: message.data, mentions }, threadId, type).catch(e => log.error("Reply Error:", e.message));
            };

            // --- XỬ LÝ EVENT HANDLERS (bỏ qua alwaysRun đã chạy ở trên) ---
            let handledByEvent = false;
            for (const evt of eventHandlers) {
                if (evt.alwaysRun) continue; // đã chạy trước rental gate
                try {
                    if (typeof evt.handle === "function") {
                        if (await evt.handle({ ...ctx, content: processedContent })) { handledByEvent = true; break; }
                    }
                } catch (e) { log.error(`Lỗi event [${evt.name}]:`, e.message); }
            }
            if (handledByEvent) return;

            // --- XỬ LÝ LỆNH (COMMAND) ---
            let isCommand = false, cmdStr = "";
            let sanitized = processedContent.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
            if (currentPrefix && sanitized.startsWith(currentPrefix)) {
                isCommand = true;
                cmdStr = sanitized.slice(currentPrefix.length).trim();
            }

            if (isCommand) {
                if (!cmdStr) return;
                let parts = cmdStr.split(/\s+/);
                let cName = parts[0].toLowerCase();
                const args = parts.slice(1);
                const handler = allCommands[cName];

                log.chat(isGroup ? "GROUP" : "PRIVATE", senderName, threadId, `⚡ [COMMAND] ${cName.toUpperCase()}`, groupName);

                if (handler) {
                    // --- KIỂM TRA COOLDOWN (TRỪ ADMIN) ---
                    if (!isOwner) {
                        const timeLeft = cooldownManager.getRemainingCooldown(senderId, cName, 5);
                        if (timeLeft) {
                            return api.sendMessage({ msg: `⚠️ Bạn đang trong thời gian chờ! Vui lòng đợi ${timeLeft}s nữa để tiếp tục dùng lệnh !${cName}.` }, threadId, type);
                        }
                        cooldownManager.setCooldown(senderId, cName, 5);
                    }

                    const reactionInterval = setInterval(() => {
                        api.addReaction(Math.random() > 0.5 ? "ok" : "akoi", message).catch(() => {});
                    }, 5000);
                    try {
                        api.sendTypingEvent(threadId, type).catch(() => {});
                        await handler({ ...ctx, args });
                    } catch (e) {
                        log.error(`Lỗi command !${cName}:`, e.message);
                        await api.sendMessage({ msg: `⚠️ Lỗi: ${e.message}` }, threadId, type).catch(() => {});
                    } finally { clearInterval(reactionInterval); }
                } else {
                    // --- LỆNH KHÔNG TỒN TẠI: GỢI Ý LỆNH GẦN NHẤT ---
                    const send = (msg) => api.sendMessage({ msg }, threadId, type);
                    const cmdList = Object.keys(allCommands);
                    const best = cmdList.reduce((acc, cmd) => {
                        const dist = levenshteinDistance(cName, cmd);
                        return dist < acc.dist ? { cmd, dist } : acc;
                    }, { cmd: cmdList[0] || "help", dist: Infinity });

                    const formatUptime = () => {
                        const s = Math.floor(process.uptime());
                        const h = Math.floor(s / 3600);
                        const m = Math.floor((s % 3600) / 60);
                        const sec = s % 60;
                        return `${h > 0 ? h + "h " : ""}${m > 0 ? m + "m " : ""}${sec}s`;
                    };

                    const notFoundText =
                        `❓ Không tìm thấy lệnh: ${currentPrefix}${cName}\n` +
                        `👤 ${senderName}\n` +
                        `💡 Ý bạn là: ${currentPrefix}${best.cmd} ?\n` +
                        `📋 Gõ ${currentPrefix}help để xem danh sách lệnh.\n` +
                        `⏰ Uptime: ${formatUptime()}`;

                    await send(notFoundText);
                }
            } else {
                if (!isSelf) log.chat(isGroup ? "GROUP" : "PRIVATE", senderName, threadId, content, groupName);
            }

        } catch (err) { log.error("Lỗi listener:", err.stack); }
        finally {
            // GIẢI PHÓNG BỘ NHỚ TRIỆT ĐỂ
            ctx = null;
            message = null;
        }
    });

    // Các listener khác
    listener.on("undo", async (undo) => {
        const { isGroup, data } = undo;
        const threadId = isGroup ? String(data.idTo || "") : String(data.uidFrom || "");
        // data.content chứa trực tiếp globalMsgId/cliMsgId của tin bị thu hồi
        // data.content.deleteMsg là một number (không phải object)
        const content = data?.content || {};
        const ctx = {
            api, undo, threadId,
            threadType: isGroup ? 1 : 0,
            senderId: String(data.uidFrom || ""),
            senderName: data.dName || "",
            msgId: String(content.globalMsgId || ""),
            cliMsgId: String(content.cliMsgId || ""),
            log, adminIds
        };
        for (const evt of eventHandlers) { if (evt.handleUndo) await evt.handleUndo(ctx).catch(e => log.error(e.message)); }
    });

    listener.on("reaction", async (event) => {
        try {
            const type = event.threadType ?? (event.data?.threadType ?? 0);
            const ctx = { api, event: event.data || event, reaction: event, threadId: event.threadId, threadType: type, isGroup: type === 1, log };
            for (const evt of eventHandlers) {
                if (typeof evt.handleReaction === "function") {
                    await evt.handleReaction(ctx).catch(e => log.error(`Lỗi reaction [${evt.name}]:`, e.message));
                }
            }
        } catch (err) { log.error("Lỗi listener reaction:", err.message); }
    });

    listener.on("group_event", async (event) => {
        // Cập nhật cache admin trực tiếp bằng sourceId từ event (không cần fetch lại Zalo API)
        const act = event.data?.act || event.data?.actType || event.data?.eventType || "";
        const tid = event.threadId;
        const rawData = event.data?.content || event.data?.data;
        let parsed = null;
        try {
            parsed = typeof rawData === "string" ? JSON.parse(rawData) : rawData;
        } catch {}
        const affectedUid = String(parsed?.sourceId || parsed?.targetId || parsed?.userId || "");

        if (affectedUid && tid) {
            if (act === "add_admin") {
                groupAdminManager.addToCache(tid, affectedUid);
            } else if (act === "remove_admin") {
                groupAdminManager.removeFromCache(tid, affectedUid);
            } else if (act === "change_owner") {
                groupAdminManager.clearCache(tid); // Owner đổi thì fetch lại cho chắc
            }
        }

        if (!rentalManager.isRented(event.threadId) && !adminIds.includes(event.data?.uidFrom)) return;
        const ctx = { api, event, threadId: event.threadId, threadType: 1, isGroup: true, adminIds, log };
        for (const evt of eventHandlers) { if (evt.handleGroupEvent) await evt.handleGroupEvent(ctx).catch(e => log.error(e.message)); }
    });

    listener.start();
    log.success(`Bot Titan đã sẵn sàng! Prefix: "${prefix}"`);

    // Quét lịch sử (Memory Safe - Chỉ quét 10 tin)
    (async () => {
        try {
            const groupsResp = await api.getAllGroups().catch(() => ({ gridVerMap: {} }));
            const groupIds = Object.keys(groupsResp.gridVerMap || {});
            for (const gId of groupIds) {
                if (!rentalManager.isRented(gId)) continue;
                const history = await api.getGroupChatHistory(gId, 10).catch(() => []);
                for (const msg of history) {
                    const cData = {
                        content: typeof msg.content === "string" ? msg.content : (msg.content?.text || null),
                        senderName: msg.dName || "User", senderId: String(msg.uidFrom || ""), threadId: gId, type: 1,
                        msgId: msg.msgId, cliMsgId: msg.cliMsgId, globalMsgId: msg.globalMsgId
                    };
                    if (msg.msgId) messageCache.set(msg.msgId, cData);
                }
            }
        } catch (e) {}
    })();
}
