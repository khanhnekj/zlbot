import FormData from "form-data";
import fs from "node:fs";
import { appContext } from "../context.js";
import { ZaloApiError } from "../Errors/ZaloApiError.js";
import { encodeAES, getFullTimeFromMilisecond, getImageMetaData, handleZaloResponse, request, makeURL } from "../utils.js";

export function changeAccountAvatarFactory(api) {
    const serviceURL = makeURL(`${api.zpwServiceMap.file[0]}/api/profile/upavatar`);

    return async function changeAccountAvatar(avatarPath) {
        if (!appContext.secretKey || !appContext.imei || !appContext.cookie || !appContext.userAgent)
            throw new ZaloApiError("Missing required app context fields");
        if (!avatarPath) throw new ZaloApiError("Missing avatarPath");
        if (!fs.existsSync(avatarPath)) throw new ZaloApiError("Avatar file not found");

        const imageMetaData = await getImageMetaData(avatarPath);
        const fileSize = fs.statSync(avatarPath).size;

        const params = {
            avatarSize: 120,
            clientId: String(appContext.uid + getFullTimeFromMilisecond(Date.now())),
            language: appContext.language,
            metaData: JSON.stringify({
                origin: {
                    width: imageMetaData.width || 1080,
                    height: imageMetaData.height || 1080,
                },
                processed: {
                    width: imageMetaData.width || 1080,
                    height: imageMetaData.height || 1080,
                    size: fileSize,
                },
            }),
        };

        const formData = new FormData();
        formData.append("fileContent", fs.readFileSync(avatarPath), {
            filename: "blob",
            contentType: "image/jpeg",
        });

        const encryptedParams = encodeAES(appContext.secretKey, JSON.stringify(params));
        if (!encryptedParams) throw new ZaloApiError("Failed to encrypt params");

        const response = await request(makeURL(serviceURL, { params: encryptedParams }), {
            method: "POST",
            headers: formData.getHeaders(),
            body: formData.getBuffer(),
        });

        const result = await handleZaloResponse(response);
        if (result.error) throw new ZaloApiError(result.error.message || "Lỗi từ Zalo API", result.error.code);
        return result.data;
    };
}
