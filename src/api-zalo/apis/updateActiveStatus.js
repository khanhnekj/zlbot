import { appContext } from "../context.js";
import { ZaloApiError } from "../index.js";
import { encodeAES, handleZaloResponse, makeURL, request } from "../utils.js";

export function updateActiveStatusFactory(api) {
    const pingURL  = makeURL(`${api.zpwServiceMap.profile[0]}/api/social/profile/ping`);
    const deactURL = makeURL(`${api.zpwServiceMap.profile[0]}/api/social/profile/deactive`);
    return async function updateActiveStatus(active) {
        const params = { status: active ? 1 : 0, imei: appContext.imei };
        const encryptedParams = encodeAES(appContext.secretKey, JSON.stringify(params));
        if (!encryptedParams) throw new ZaloApiError("Failed to encrypt params");
        const targetURL = active ? pingURL : deactURL;
        const response = await request(makeURL(targetURL, { params: encryptedParams }), { method: "GET" });
        const result = await handleZaloResponse(response);
        if (result.error) throw new ZaloApiError(result.error.message, result.error.code);
        return result.data;
    };
}
