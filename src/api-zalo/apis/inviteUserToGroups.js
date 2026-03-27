import { appContext } from "../context.js";
import { ZaloApiError } from "../index.js";
import { encodeAES, handleZaloResponse, makeURL, request } from "../utils.js";

export function inviteUserToGroupsFactory(api) {
    const serviceURL = makeURL(`${api.zpwServiceMap.group[0]}/api/group/invite/multi`);
    return async function inviteUserToGroups(userId, groupId) {
        const params = {
            grids: Array.isArray(groupId) ? groupId : [groupId],
            member: userId,
            memberType: -1,
            srcInteraction: 2,
            clientLang: appContext.language,
        };
        const encryptedParams = encodeAES(appContext.secretKey, JSON.stringify(params));
        if (!encryptedParams) throw new ZaloApiError("Failed to encrypt params");
        const response = await request(makeURL(serviceURL, { params: encryptedParams }), { method: "GET" });
        return handleZaloResponse(response);
    };
}
