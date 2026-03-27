import { appContext } from "../context.js";
import { ZaloApiError } from "../index.js";
import { encodeAES, handleZaloResponse, makeURL, request } from "../utils.js";

export function disperseGroupFactory(api) {
    const serviceURL = makeURL(`${api.zpwServiceMap.group[0]}/api/group/disperse`);
    return async function disperseGroup(groupId) {
        const params = { grid: groupId, imei: appContext.imei };
        const encryptedParams = encodeAES(appContext.secretKey, JSON.stringify(params));
        if (!encryptedParams) throw new ZaloApiError("Failed to encrypt params");
        const response = await request(serviceURL, { method: "POST", body: new URLSearchParams({ params: encryptedParams }) });
        return handleZaloResponse(response);
    };
}
