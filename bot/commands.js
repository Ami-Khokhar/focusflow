import { getMemoryItems, clearMessages, updateUser } from '../lib/db.js';
import { sendBriefing } from './handlers/chat.js';
import { toTelegramHTML } from './utils/format.js';
import { splitMessage } from './utils/message.js';

export function registerCommands(bot) {
    bot.command('start', handleStart);
    bot.command('briefing', handleBriefing);
    bot.command('memory', handleMemory);
    bot.command('help', handleHelp);
    bot.command('clear', handleClear);
    bot.command('timezone', handleTimezone);
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

    return ctx.reply(
        `Welcome back, <b>${user.display_name || 'Friend'}</b>! I'm here whenever you need me.\n\n` +
        'Try /briefing for your daily overview, or send me anything on your mind.',
        { parse_mode: 'HTML' }
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
                text += `• ${item.content}${timeNote}\n`;
            }
        }

        const parts = splitMessage(text);
        for (const part of parts) {
            await ctx.reply(part, { parse_mode: 'HTML' });
        }
    } catch (err) {
        console.error('[/memory] Error:', err.message);
        await ctx.reply("Couldn't load your items right now.");
    }
}

async function handleHelp(ctx) {
    await ctx.reply(
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
        '/clear — Fresh start, clear chat history\n' +
        '/timezone Asia/Kolkata — Set your timezone\n' +
        '/help — This message',
        { parse_mode: 'HTML' }
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
        return ctx.reply(
            `Your current timezone: <b>${current}</b>\n\nTo change it:\n<code>/timezone Asia/Kolkata</code>`,
            { parse_mode: 'HTML' }
        );
    }

    // Validate timezone
    try {
        Intl.DateTimeFormat(undefined, { timeZone: tz });
    } catch {
        return ctx.reply(
            `"${tz}" isn't a valid timezone.\n\nExamples: <code>Asia/Kolkata</code>, <code>America/New_York</code>, <code>Europe/London</code>`,
            { parse_mode: 'HTML' }
        );
    }

    try {
        await updateUser(user.id, { timezone: tz });
        await ctx.reply(`Timezone updated to <b>${tz}</b>`, { parse_mode: 'HTML' });
    } catch (err) {
        console.error('[/timezone] Error:', err.message);
        await ctx.reply("Couldn't update timezone right now.");
    }
}
