import { appContext } from "../context.js";
import { ZaloApiError } from "../index.js";
import { encodeAES, handleZaloResponse, makeURL, request } from "../utils.js";

export function getSentFriendRequestFactory(api) {
    const serviceURL = makeURL(`${api.zpwServiceMap.friend[0]}/api/friend/requested/list`);
    return async function getSentFriendRequest() {
        const params = { imei: appContext.imei };
        const encryptedParams = encodeAES(appContext.secretKey, JSON.stringify(params));
        if (!encryptedParams) throw new ZaloApiError("Failed to encrypt params");
        const response = await request(makeURL(serviceURL, { params: encryptedParams }), { method: "GET" });
        const result = await handleZaloResponse(response);
        if (result.error) throw new ZaloApiError(result.error.message, result.error.code);
        return result.data;
    };
}
