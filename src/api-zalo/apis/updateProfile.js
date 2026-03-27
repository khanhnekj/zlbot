import { appContext } from "../context.js";
import { ZaloApiError } from "../index.js";
import { encodeAES, makeURL, request } from "../utils.js";

export function updateProfileFactory(api) {
    const serviceURL = makeURL(`${api.zpwServiceMap.profile[0]}/api/social/profile/update`);
    return async function updateProfile(payload) {
        const params = {
            profile: JSON.stringify({
                name: payload.profile?.name,
                dob: payload.profile?.dob,
                gender: payload.profile?.gender,
            }),
            biz: JSON.stringify({
                desc: payload.biz?.description || payload.biz?.desc,
                cate: payload.biz?.cate,
                addr: payload.biz?.address,
                website: payload.biz?.website,
                email: payload.biz?.email,
            }),
            language: appContext.language,
        };
        const encryptedParams = encodeAES(appContext.secretKey, JSON.stringify(params));
        if (!encryptedParams) throw new ZaloApiError("Failed to encrypt params");
        const response = await request(serviceURL, {
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
