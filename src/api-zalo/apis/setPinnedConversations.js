import { appContext } from "../context.js";
import { ZaloApiError } from "../index.js";
import { encodeAES, handleZaloResponse, makeURL, request } from "../utils.js";
import { MessageType } from "../models/Message.js";

export function setPinnedConversationsFactory(api) {
    const serviceURL = makeURL(`${api.zpwServiceMap.conversation[0]}/api/pinconvers/updatev2`);
    return async function setPinnedConversations(pinned, threadId, type = MessageType.DirectMessage) {
        if (typeof threadId === "string") threadId = [threadId];
        const isGroup = type === MessageType.GroupMessage;
        const params = {
            actionType: pinned ? 1 : 2,
            conversations: isGroup ? threadId.map(id => `g${id}`) : threadId.map(id => `u${id}`),
        };
        const encryptedParams = encodeAES(appContext.secretKey, JSON.stringify(params));
        if (!encryptedParams) throw new ZaloApiError("Failed to encrypt params");
        const response = await request(serviceURL, { method: "POST", body: new URLSearchParams({ params: encryptedParams }) });
        return handleZaloResponse(response);
    };
}
