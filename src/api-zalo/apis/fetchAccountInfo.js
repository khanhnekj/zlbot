import { appContext } from "../context.js";
import { ZaloApiError } from "../index.js";
import { handleZaloResponse, makeURL, request } from "../utils.js";

export function fetchAccountInfoFactory(api) {
    const serviceURL = makeURL(`${api.zpwServiceMap.profile[0]}/api/social/profile/me-v2`);
    return async function fetchAccountInfo() {
        if (!appContext.secretKey || !appContext.imei || !appContext.cookie || !appContext.userAgent)
            throw new ZaloApiError("Missing required app context fields");
        const response = await request(serviceURL, { method: "GET" });
        const result = await handleZaloResponse(response);
        if (result.error) throw new ZaloApiError(result.error.message, result.error.code);
        return result.data;
    };
}
