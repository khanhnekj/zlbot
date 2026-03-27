import { appContext } from "../context.js";
import { ZaloApiError } from "../index.js";
import { encodeAES, handleZaloResponse, makeURL, request } from "../utils.js";
import { MessageType } from "../models/Message.js";

export function sendDeliveredEventFactory(api) {
    const serviceURL = {
        [MessageType.DirectMessage]: makeURL(`${api.zpwServiceMap.chat[0]}/api/message/deliveredv2`),
        [MessageType.GroupMessage]:  makeURL(`${api.zpwServiceMap.group[0]}/api/group/deliveredv2`),
    };
    return async function sendDeliveredEvent(isSeen, messages, type = MessageType.DirectMessage) {
        if (!messages) throw new ZaloApiError("Missing messages");
        if (!Array.isArray(messages)) messages = [messages];
        const isGroup = type === MessageType.GroupMessage;
        const idTo = messages[0].idTo;
        const msgInfos = {
            seen: isSeen ? 1 : 0,
            data: messages.map(msg => ({
                cmi: msg.cliMsgId, gmi: msg.msgId, si: msg.uidFrom,
                di: msg.idTo === appContext.uid ? "0" : msg.idTo,
                mt: msg.msgType, st: 0, at: -1, cmd: -1,
                ts: parseInt(`${msg.ts}`) || 0,
            })),
            ...(isGroup ? { grid: idTo } : {}),
        };
        const params = { msgInfos: JSON.stringify(msgInfos), ...(isGroup ? { imei: appContext.imei } : {}) };
        const encryptedParams = encodeAES(appContext.secretKey, JSON.stringify(params));
        if (!encryptedParams) throw new ZaloApiError("Failed to encrypt params");
        const response = await request(serviceURL[type], { method: "POST", body: new URLSearchParams({ params: encryptedParams }) });
        return handleZaloResponse(response);
    };
}
