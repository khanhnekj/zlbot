import { appContext } from "../context.js";
import { ZaloApiError } from "../index.js";
import { encodeAES, handleZaloResponse, makeURL, request } from "../utils.js";

export function blockUserFactory(api) {
    const serviceURL = makeURL(`${api.zpwServiceMap.friend[0]}/api/friend/block`);
    return async function blockUser(userId) {
        const params = { fid: userId, imei: appContext.imei };
        const encryptedParams = encodeAES(appContext.secretKey, JSON.stringify(params));
        if (!encryptedParams) throw new ZaloApiError("Failed to encrypt params");
        const response = await request(serviceURL, { method: "POST", body: new URLSearchParams({ params: encryptedParams }) });
        const result = await handleZaloResponse(response);
        if (result.error) throw new ZaloApiError(result.error.message, result.error.code);
        return result.data;
    };
}
