/**
 * HTML-safe reply helpers.
 * If Telegram rejects the HTML, strip all tags and resend as plain text.
 */

export async function safeReply(ctx, html, options = {}) {
    try {
        await ctx.reply(html, { parse_mode: 'HTML', ...options });
    } catch (err) {
        if (err.description?.includes('parse')) {
            await ctx.reply(html.replace(/<[^>]+>/g, ''), options);
        } else throw err;
    }
}

export async function safeReplyParts(ctx, parts, options = {}) {
    for (const part of parts) await safeReply(ctx, part, options);
}

/**
 * Same as safeReply but for bot.api.sendMessage (used by cron jobs).
 */
export async function safeSendMessage(api, chatId, html, options = {}) {
    try {
        await api.sendMessage(chatId, html, { parse_mode: 'HTML', ...options });
    } catch (err) {
        if (err.description?.includes('parse')) {
            await api.sendMessage(chatId, html.replace(/<[^>]+>/g, ''), options);
        } else throw err;
    }
}
