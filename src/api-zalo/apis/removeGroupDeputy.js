import { appContext } from "../context.js";
import { ZaloApiError } from "../index.js";
import { encodeAES, handleZaloResponse, makeURL, request } from "../utils.js";

export function removeGroupDeputyFactory(api) {
    const serviceURL = makeURL(`${api.zpwServiceMap.group[0]}/api/group/admins/remove`);
    return async function removeGroupDeputy(memberId, groupId) {
        if (!Array.isArray(memberId)) memberId = [memberId];
        const params = { grid: groupId, members: memberId, imei: appContext.imei };
        const encryptedParams = encodeAES(appContext.secretKey, JSON.stringify(params));
        if (!encryptedParams) throw new ZaloApiError("Failed to encrypt params");
        const response = await request(makeURL(serviceURL, { params: encryptedParams }), { method: "GET" });
        return handleZaloResponse(response);
    };
}
