import { appContext } from "../context.js";
import { ZaloApiError } from "../index.js";
import { encodeAES, handleZaloResponse, makeURL, request } from "../utils.js";
import { MessageType } from "../models/Message.js";

export const MuteDuration = { ONE_HOUR: 3600, FOUR_HOURS: 14400, FOREVER: -1, UNTIL_8AM: "until8AM" };
export const MuteAction   = { MUTE: 1, UNMUTE: 3 };

export function setMuteFactory(api) {
    const serviceURL = makeURL(`${api.zpwServiceMap.profile[0]}/api/social/profile/setmute`);
    return async function setMute(params = {}, threadId, type = MessageType.DirectMessage) {
        const { duration = MuteDuration.FOREVER, action = MuteAction.MUTE } = params;
        let muteDuration;
        if (action === MuteAction.UNMUTE || duration === MuteDuration.FOREVER) {
            muteDuration = -1;
        } else if (duration === MuteDuration.UNTIL_8AM) {
            const now = new Date(), next8AM = new Date(now);
            next8AM.setHours(8, 0, 0, 0);
            if (now.getHours() >= 8) next8AM.setDate(next8AM.getDate() + 1);
            muteDuration = Math.floor((next8AM.getTime() - now.getTime()) / 1000);
        } else {
            muteDuration = duration;
        }
        const requestParams = {
            toid: threadId, duration: muteDuration, action, startTime: Math.floor(Date.now() / 1000),
            muteType: type === MessageType.DirectMessage ? 1 : 2, imei: appContext.imei,
        };
        const encryptedParams = encodeAES(appContext.secretKey, JSON.stringify(requestParams));
        if (!encryptedParams) throw new ZaloApiError("Failed to encrypt params");
        const response = await request(serviceURL, { method: "POST", body: new URLSearchParams({ params: encryptedParams }) });
        return handleZaloResponse(response);
    };
}
