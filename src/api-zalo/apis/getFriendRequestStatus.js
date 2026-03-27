import { appContext } from "../context.js";
import { ZaloApiError } from "../index.js";
import { encodeAES, handleZaloResponse, makeURL, request } from "../utils.js";

export function getFriendRequestStatusFactory(api) {
    const serviceURL = makeURL(`${api.zpwServiceMap.friend[0]}/api/friend/reqstatus`);
    return async function getFriendRequestStatus(friendId) {
        const params = { fid: friendId, imei: appContext.imei };
        const encryptedParams = encodeAES(appContext.secretKey, JSON.stringify(params));
        if (!encryptedParams) throw new ZaloApiError("Failed to encrypt params");
        const response = await request(makeURL(serviceURL, { params: encryptedParams }), { method: "GET" });
        return handleZaloResponse(response);
    };
}
