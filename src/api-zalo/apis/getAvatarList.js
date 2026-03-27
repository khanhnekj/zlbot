import { appContext } from "../context.js";
import { ZaloApiError } from "../Errors/ZaloApiError.js";
import { encodeAES, handleZaloResponse, request, makeURL } from "../utils.js";

export function getAvatarListFactory(api) {
    const serviceURL = makeURL(`${api.zpwServiceMap.profile[0]}/api/social/avatar-list`);

    return async function getAvatarList(count = 50, page = 1) {
        if (!appContext.secretKey || !appContext.imei || !appContext.cookie || !appContext.userAgent)
            throw new ZaloApiError("Missing required app context fields");

        const params = {
            page,
            albumId: "0",
            count,
            imei: appContext.imei,
        };

        const encryptedParams = encodeAES(appContext.secretKey, JSON.stringify(params));
        if (!encryptedParams) throw new ZaloApiError("Failed to encrypt params");

        const response = await request(makeURL(serviceURL, { params: encryptedParams }), {
            method: "GET",
        });

        const result = await handleZaloResponse(response);
        if (result.error) throw new ZaloApiError(result.error.message || "Lỗi từ Zalo API", result.error.code);
        return result.data;
    };
}
