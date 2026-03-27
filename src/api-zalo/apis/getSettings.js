import { appContext } from "../context.js";
import { ZaloApiError } from "../index.js";
import { encodeAES, handleZaloResponse, makeURL, request } from "../utils.js";

export function getSettingsFactory(_api) {
    const serviceURL = makeURL(`https://wpa.chat.zalo.me/api/setting/me`);
    return async function getSettings() {
        const encryptedParams = encodeAES(appContext.secretKey, JSON.stringify({}));
        if (!encryptedParams) throw new ZaloApiError("Failed to encrypt params");
        const response = await request(makeURL(serviceURL, { params: encryptedParams }), { method: "GET" });
        return handleZaloResponse(response);
    };
}
