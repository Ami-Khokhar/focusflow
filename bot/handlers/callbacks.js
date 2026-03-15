import { updateMemoryItem, markMemoryItemDone } from '../../lib/db.js';

/**
 * Handle inline keyboard callback queries (reminder keep/dismiss, task done).
 */
export async function handleCallback(ctx) {
    const data = ctx.callbackQuery.data;
    const user = ctx.flowyUser;

    if (!user) {
        return ctx.answerCallbackQuery({ text: 'Session expired. Send /start.' });
    }

    const userId = user.id;

    try {
        if (data.startsWith('keep:')) {
            const itemId = data.slice(5);
            await updateMemoryItem(userId, itemId, { category: 'Note', remind_at: null });
            await ctx.answerCallbackQuery({ text: 'Kept as a note!' });
            await ctx.editMessageReplyMarkup({ reply_markup: undefined });
            await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n✓ Kept as note', { parse_mode: 'HTML' });

        } else if (data.startsWith('dismiss:')) {
            const itemId = data.slice(8);
            await updateMemoryItem(userId, itemId, { status: 'Archived' });
            await ctx.answerCallbackQuery({ text: 'Dismissed!' });
            await ctx.editMessageReplyMarkup({ reply_markup: undefined });
            await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n✓ Dismissed', { parse_mode: 'HTML' });

        } else if (data.startsWith('done:')) {
            const itemId = data.slice(5);
            await markMemoryItemDone(userId, itemId);
            await ctx.answerCallbackQuery({ text: 'Marked as done!' });
            await ctx.editMessageReplyMarkup({ reply_markup: undefined });
            await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n✓ Done!', { parse_mode: 'HTML' });

        } else {
            await ctx.answerCallbackQuery({ text: 'Unknown action.' });
        }
    } catch (err) {
        console.error('[Callback] Error:', err.message);
        await ctx.answerCallbackQuery({ text: 'Something went wrong.' });
    }
}
