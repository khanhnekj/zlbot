import { appContext } from "../context.js";
import { ZaloApiError } from "../index.js";
import { encodeAES, handleZaloResponse, makeURL, request } from "../utils.js";

export function rejectFriendRequestFactory(api) {
    const serviceURL = makeURL(`${api.zpwServiceMap.friend[0]}/api/friend/reject`);
    return async function rejectFriendRequest(friendId) {
        const params = { fid: friendId };
        const encryptedParams = encodeAES(appContext.secretKey, JSON.stringify(params));
        if (!encryptedParams) throw new ZaloApiError("Failed to encrypt params");
        const response = await request(serviceURL, { method: "POST", body: new URLSearchParams({ params: encryptedParams }) });
        return handleZaloResponse(response);
    };
}
