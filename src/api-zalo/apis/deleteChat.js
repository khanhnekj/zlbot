import { appContext } from "../context.js";
import { ZaloApiError } from "../index.js";
import { encodeAES, handleZaloResponse, makeURL, request } from "../utils.js";
import { MessageType } from "../models/Message.js";

export function deleteChatFactory(api) {
    const serviceURL = {
        [MessageType.DirectMessage]: makeURL(`${api.zpwServiceMap.chat[0]}/api/message/deleteconver`, { nretry: 0 }),
        [MessageType.GroupMessage]:  makeURL(`${api.zpwServiceMap.group[0]}/api/group/deleteconver`, { nretry: 0 }),
    };
    return async function deleteChat(lastMessage, threadId, type = MessageType.DirectMessage) {
        const isGroup = type === MessageType.GroupMessage;
        const params = {
            ...(isGroup ? { grid: threadId } : { toid: threadId }),
            cliMsgId: Date.now().toString(), conver: lastMessage, onlyMe: 1, imei: appContext.imei,
        };
        const encryptedParams = encodeAES(appContext.secretKey, JSON.stringify(params));
        if (!encryptedParams) throw new ZaloApiError("Failed to encrypt params");
        const response = await request(serviceURL[type], { method: "POST", body: new URLSearchParams({ params: encryptedParams }) });
        return handleZaloResponse(response);
    };
}
