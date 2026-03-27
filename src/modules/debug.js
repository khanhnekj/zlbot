export const name = "debug";
export const description = "Debug tools";

export const commands = {
    debugquote: async (ctx) => {
        try {
            if (!ctx.message || !ctx.message.data) {
                await ctx.api.sendMessage({ msg: "No ctx.message.data found" }, ctx.threadId, ctx.threadType);
                return;
            }

            const rawData = JSON.stringify(ctx.message.data, null, 2);
            await ctx.api.sendMessage(
                { msg: "RAW DATA:\n" + rawData.substring(0, 1500) },
                ctx.threadId, ctx.threadType
            );
        } catch (e) {
            console.error(e);
        }
    }
};
