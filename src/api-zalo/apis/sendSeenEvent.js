import { appContext } from "../context.js";
import { ZaloApiError } from "../index.js";
import { encodeAES, handleZaloResponse, makeURL, request } from "../utils.js";
import { MessageType } from "../models/Message.js";

export function sendSeenEventFactory(api) {
    const serviceURL = {
        [MessageType.DirectMessage]: makeURL(`${api.zpwServiceMap.chat[0]}/api/message/seenv2`, { nretry: 0 }),
        [MessageType.GroupMessage]:  makeURL(`${api.zpwServiceMap.group[0]}/api/group/seenv2`, { nretry: 0 }),
    };
    return async function sendSeenEvent(messages, type = MessageType.DirectMessage) {
        if (!messages) throw new ZaloApiError("Missing messages");
        if (!Array.isArray(messages)) messages = [messages];
        const isGroup = type === MessageType.GroupMessage;
        const threadId = isGroup ? messages[0].idTo : messages[0].uidFrom;
        const msgInfos = {
            data: messages.map(msg => ({
                cmi: msg.cliMsgId, gmi: msg.msgId, si: msg.uidFrom,
                di: msg.idTo === appContext.uid ? "0" : msg.idTo,
                mt: msg.msgType, st: 0, at: -1, cmd: -1,
                ts: parseInt(`${msg.ts}`) || 0,
            })),
            [isGroup ? "grid" : "senderId"]: threadId,
        };
        const params = { msgInfos: JSON.stringify(msgInfos), ...(isGroup ? { imei: appContext.imei } : {}) };
        const encryptedParams = encodeAES(appContext.secretKey, JSON.stringify(params));
        if (!encryptedParams) throw new ZaloApiError("Failed to encrypt params");
        const response = await request(serviceURL[type], { method: "POST", body: new URLSearchParams({ params: encryptedParams }) });
        return handleZaloResponse(response);
    };
}
