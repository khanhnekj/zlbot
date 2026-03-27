import { appContext } from "../context.js";
import { ZaloApiError } from "../index.js";
import { encodeAES, makeURL, request } from "../utils.js";

export function updateProfileBioFactory(api) {
    const serviceURL = makeURL(`${api.zpwServiceMap.profile[0]}/api/social/profile/status`);
    return async function updateProfileBio(status) {
        if (!appContext.secretKey || !appContext.imei || !appContext.cookie || !appContext.userAgent)
            throw new ZaloApiError("Missing required app context fields");
        const params = { status };
        const encryptedParams = encodeAES(appContext.secretKey, JSON.stringify(params));
        if (!encryptedParams) throw new ZaloApiError("Failed to encrypt params");
        const response = await request(makeURL(serviceURL, { params: encryptedParams }), {
            method: "POST",
            body: new URLSearchParams({ params: encryptedParams }),
        });
        if (!response.ok) throw new ZaloApiError("Request failed with status code " + response.status);
        const json = await response.json().catch(() => null);
        if (json && json.error_code != null && json.error_code !== 0)
            throw new ZaloApiError(json.error_message || "Lỗi từ Zalo API", json.error_code);
        return "";
    };
}
