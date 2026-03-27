import { appContext } from "../context.js";
import { ZaloApiError } from "../index.js";
import { encodeAES, handleZaloResponse, makeURL, request } from "../utils.js";

export function votePollFactory(api) {
    const serviceURL = makeURL(`${api.zpwServiceMap.group[0]}/api/poll/vote`);
    return async function votePoll(pollId, optionId) {
        if (!Array.isArray(optionId)) optionId = [optionId];
        const params = { poll_id: pollId, option_ids: optionId, imei: appContext.imei };
        const encryptedParams = encodeAES(appContext.secretKey, JSON.stringify(params));
        if (!encryptedParams) throw new ZaloApiError("Failed to encrypt params");
        const response = await request(makeURL(serviceURL, { params: encryptedParams }), { method: "GET" });
        return handleZaloResponse(response);
    };
}
