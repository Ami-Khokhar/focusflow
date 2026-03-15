import {
    getMemoryItems,
    clearMessages,
    updateUser,
    markMemoryItemDone,
    getLatestActiveTask,
    updateSession,
} from '../lib/db.js';
import { sendBriefing } from './handlers/chat.js';
import { escapeHTML } from './utils/format.js';
import { splitMessage } from './utils/message.js';
import { safeReply, safeReplyParts } from './utils/safeReply.js';
import { InlineKeyboard } from 'grammy';

export function registerCommands(bot) {
    bot.command('start', handleStart);
    bot.command('briefing', handleBriefing);
    bot.command('memory', handleMemory);
    bot.command('help', handleHelp);
    bot.command('clear', handleClear);
    bot.command('timezone', handleTimezone);
    bot.command('done', handleDone);
    bot.command('focus', handleFocus);
}

async function handleStart(ctx) {
    const user = ctx.flowyUser;
    if (!user) return ctx.reply('Something went wrong. Please try again.');

    const isOnboarding = (user.onboarding_step ?? 3) < 3;

    if (isOnboarding) {
        return ctx.reply(
            "Hey! Welcome to Flowy. I'm your ADHD-friendly productivity buddy.\n\n" +
            "Before we dive in — what should I call you?",
            { parse_mode: 'HTML' }
        );
    }

    return safeReply(ctx,
        `Welcome back, <b>${escapeHTML(user.display_name || 'Friend')}</b>! I'm here whenever you need me.\n\n` +
        'Try /briefing for your daily overview, or send me anything on your mind.'
    );
}

async function handleBriefing(ctx) {
    try {
        await sendBriefing(ctx);
    } catch (err) {
        console.error('[/briefing] Error:', err.message);
        await ctx.reply("Couldn't load your briefing right now. Try again in a moment.");
    }
}

async function handleMemory(ctx) {
    const user = ctx.flowyUser;
    if (!user) return ctx.reply('Something went wrong. Please try /start.');

    try {
        const items = await getMemoryItems(user.id);

        if (!items || items.length === 0) {
            return ctx.reply("You don't have any saved items yet. Tell me something to remember!");
        }

        const grouped = {};
        for (const item of items) {
            const cat = item.category || 'Note';
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(item);
        }

        let text = '<b>Your saved items:</b>\n';
        for (const [category, categoryItems] of Object.entries(grouped)) {
            text += `\n<b>${category}s:</b>\n`;
            for (const item of categoryItems.slice(0, 10)) {
                const timeNote = item.remind_at
                    ? ` (${new Date(item.remind_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })})`
                    : '';
                text += `• ${escapeHTML(item.content)}${timeNote}\n`;
            }
        }

        const parts = splitMessage(text);
        await safeReplyParts(ctx, parts);
    } catch (err) {
        console.error('[/memory] Error:', err.message);
        await ctx.reply("Couldn't load your items right now.");
    }
}

async function handleHelp(ctx) {
    await safeReply(ctx,
        '<b>Flowy — Your ADHD-friendly buddy</b>\n\n' +
        'I get how ADHD brains work. No judgment, no pressure — I\'m here to help you stay on track at your own pace.\n\n' +
        '<b>What I can help with:</b>\n' +
        '• <b>Reminders</b> — "Remind me to take meds in 20 minutes"\n' +
        '• <b>Task capture</b> — "Save task: finish the report"\n' +
        '• <b>Task completion</b> — "I finished the report"\n' +
        '• <b>Notes & ideas</b> — "Remember that the meeting moved to Thursday"\n' +
        '• <b>Forget things</b> — "Forget that reminder" / "Never mind"\n' +
        '• <b>Reschedule</b> — "Push that back 10 minutes"\n' +
        '• <b>Daily briefing</b> — Overview of your tasks and reminders\n' +
        '• <b>Check-ins</b> — Gentle nudges every 25 min when you\'re working\n' +
        '• <b>Emotional support</b> — Vent, feel stuck, or feel overwhelmed — I\'ll listen\n\n' +
        '<b>Commands:</b>\n' +
        '/briefing — Daily overview of tasks & reminders\n' +
        '/memory — See everything you\'ve saved\n' +
        '/done — Mark a task as complete\n' +
        '/focus — Start a 25-minute focus session\n' +
        '/clear — Fresh start, clear chat history\n' +
        '/timezone Asia/Kolkata — Set your timezone\n' +
        '/help — This message'
    );
}

async function handleClear(ctx) {
    const sessionId = ctx.flowySessionId;
    if (!sessionId) return ctx.reply('No active session found.');

    try {
        await clearMessages(sessionId);
        await ctx.reply('Chat history cleared. Fresh start!');
    } catch (err) {
        console.error('[/clear] Error:', err.message);
        await ctx.reply("Couldn't clear history right now.");
    }
}

async function handleTimezone(ctx) {
    const user = ctx.flowyUser;
    if (!user) return ctx.reply('Something went wrong. Please try /start.');

    const text = ctx.message.text;
    const parts = text.split(/\s+/);
    const tz = parts[1];

    if (!tz) {
        const current = user.timezone || 'not set';
        return safeReply(ctx,
            `Your current timezone: <b>${current}</b>\n\nTo change it:\n<code>/timezone Asia/Kolkata</code>`
        );
    }

    try {
        Intl.DateTimeFormat(undefined, { timeZone: tz });
    } catch {
        return safeReply(ctx,
            `"${escapeHTML(tz)}" isn't a valid timezone.\n\nExamples: <code>Asia/Kolkata</code>, <code>America/New_York</code>, <code>Europe/London</code>`
        );
    }

    try {
        await updateUser(user.id, { timezone: tz });
        await safeReply(ctx, `Timezone updated to <b>${escapeHTML(tz)}</b>`);
    } catch (err) {
        console.error('[/timezone] Error:', err.message);
        await ctx.reply("Couldn't update timezone right now.");
    }
}

async function handleDone(ctx) {
    const user = ctx.flowyUser;
    if (!user) return ctx.reply('Something went wrong. Please try /start.');

    try {
        const items = await getMemoryItems(user.id);
        const tasks = items.filter(i => i.category === 'Task' && i.status === 'Active');

        if (tasks.length === 0) {
            return ctx.reply('No active tasks. Nice work, or tell me what you need to do!');
        }

        if (tasks.length === 1) {
            await markMemoryItemDone(user.id, tasks[0].id);
            return safeReply(ctx, `Done! Marked <b>${escapeHTML(tasks[0].content)}</b> as complete.`);
        }

        const keyboard = new InlineKeyboard();
        for (const task of tasks.slice(0, 5)) {
            keyboard.text(task.content.slice(0, 40), `done:${task.id}`).row();
        }

        await safeReply(ctx, 'Which task did you finish?', { reply_markup: keyboard });
    } catch (err) {
        console.error('[/done] Error:', err.message);
        await ctx.reply("Couldn't load your tasks right now.");
    }
}

async function handleFocus(ctx) {
    const user = ctx.flowyUser;
    const sessionId = ctx.flowySessionId;
    if (!user || !sessionId) return ctx.reply('Something went wrong. Please try /start.');

    try {
        await updateSession(sessionId, {
            check_in_due_at: new Date(Date.now() + 25 * 60 * 1000).toISOString(),
        });

        const task = await getLatestActiveTask(user.id);
        const taskNote = task ? `\n\nCurrent task: <b>${escapeHTML(task.content)}</b>` : '';
        await safeReply(ctx, `Focus mode started! I'll check in with you in 25 minutes.${taskNote}`);
    } catch (err) {
        console.error('[/focus] Error:', err.message);
        await ctx.reply("Couldn't start focus mode right now.");
    }
}
