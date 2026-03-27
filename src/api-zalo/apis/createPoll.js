import { appContext } from "../context.js";
import { ZaloApiError } from "../index.js";
import { encodeAES, handleZaloResponse, makeURL, request } from "../utils.js";

export function createPollFactory(api) {
    const serviceURL = makeURL(`${api.zpwServiceMap.group[0]}/api/poll/create`);
    return async function createPoll(options, groupId) {
        const params = {
            group_id: groupId, question: options.question, options: options.options,
            expired_time: options.expiredTime ?? 0, pinAct: false,
            allow_multi_choices: !!options.allowMultiChoices,
            allow_add_new_option: !!options.allowAddNewOption,
            is_hide_vote_preview: !!options.hideVotePreview,
            is_anonymous: !!options.isAnonymous,
            poll_type: 0, src: 1, imei: appContext.imei,
        };
        const encryptedParams = encodeAES(appContext.secretKey, JSON.stringify(params));
        if (!encryptedParams) throw new ZaloApiError("Failed to encrypt params");
        const response = await request(serviceURL, { method: "POST", body: new URLSearchParams({ params: encryptedParams }) });
        return handleZaloResponse(response);
    };
}
