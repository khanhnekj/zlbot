import { appContext } from "../context.js";
import { ZaloApiError } from "../Errors/ZaloApiError.js";
import { encodeAES, handleZaloResponse, request, makeURL } from "../utils.js";

export function deleteAccountAvatarFactory(api) {
    const serviceURL = makeURL(`${api.zpwServiceMap.profile[0]}/api/social/del-avatars`);

    return async function deleteAccountAvatar(photoId) {
        if (!appContext.secretKey || !appContext.imei || !appContext.cookie || !appContext.userAgent)
            throw new ZaloApiError("Missing required app context fields");

        const photoIds = Array.isArray(photoId) ? photoId : [photoId];
        const delPhotos = photoIds.map((id) => ({ photoId: id }));

        const params = {
            delPhotos: JSON.stringify(delPhotos),
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
