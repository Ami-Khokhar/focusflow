// ────────────────────────────────────────────
//  Shared Telegram Bot instance
//  Used by both webhook (API route) and long-polling (bot/index.js)
// ────────────────────────────────────────────

import { Bot } from 'grammy';
import {
    getUserByTelegramId,
    createUser,
    getOrCreateSession,
    getUser,
    getMemoryItems,
    clearMessages,
    updateUser,
    updateMemoryItem,
    saveMessage,
    getMessages,
    getRecentMessages,
    updateSession,
    getTodayBriefing,
    saveTodayBriefing,
} from '../db.js';
import { buildSystemPrompt } from '../langchain/prompts.js';
import { createModel, createTelegramModel, convertHistory } from '../langchain/agent.js';
import { createTools } from '../langchain/tools.js';
import { streamAgentResponse, streamDemoResponse } from '../langchain/streaming.js';

// ── Utilities ─────────────────────────────────

function escapeHTML(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function toTelegramHTML(text) {
    if (!text) return '';
    let html = text;
    html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    html = html.replace(/```[\w]*\n?([\s\S]*?)```/g, '<pre>$1</pre>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    html = html.replace(/__(.+?)__/g, '<b>$1</b>');
    html = html.replace(/(?<!\w)\*([^*]+?)\*(?!\w)/g, '<i>$1</i>');
    html = html.replace(/(?<!\w)_([^_]+?)_(?!\w)/g, '<i>$1</i>');
    html = html.replace(/~~(.+?)~~/g, '<s>$1</s>');
    return html;
}

function splitMessage(text, maxLength = 4096) {
    if (!text || text.length <= maxLength) return [text || ''];
    const parts = [];
    let remaining = text;
    while (remaining.length > maxLength) {
        let splitIndex = remaining.lastIndexOf('\n\n', maxLength);
        if (splitIndex <= 0) splitIndex = remaining.lastIndexOf('\n', maxLength);
        if (splitIndex <= 0) splitIndex = remaining.lastIndexOf(' ', maxLength);
        if (splitIndex <= 0) splitIndex = maxLength;
        parts.push(remaining.slice(0, splitIndex));
        remaining = remaining.slice(splitIndex).trimStart();
    }
    if (remaining) parts.push(remaining);
    return parts;
}

function dedupeMemory(memoryItems) {
    const _normKey = (s) => (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
    const _seen = new Set();
    return memoryItems
        .filter((i) => !(i.category === 'Reminder' && i.remind_at && !i.surfaced_at))
        .filter((i) => { const k = _normKey(i.content); if (_seen.has(k)) return false; _seen.add(k); return true; })
        .slice(0, 15);
}

// ── Bot Factory ───────────────────────────────

/**
 * Create and configure a grammY Bot instance with all handlers.
 * Does NOT call bot.start() — caller decides polling vs webhook.
 */
export function createBot(token) {
    const bot = new Bot(token);

    // ── Middleware: resolve Telegram user → Flowy user + session ──
    bot.use(async (ctx, next) => {
        if (!ctx.from) return next();
        const telegramId = ctx.from.id;
        try {
            let user = await getUserByTelegramId(telegramId);
            if (!user) {
                user = await createUser(ctx.from.first_name || 'Friend', null, telegramId);
            }
            const session = await getOrCreateSession(user.id);
            const freshUser = await getUser(user.id);
            ctx.flowyUser = freshUser || user;
            ctx.flowySession = session;
            ctx.flowySessionId = session.id;
        } catch (err) {
            console.error('[Middleware] User resolution failed:', err.message);
        }
        return next();
    });

    // ── Commands ──────────────────────────────────
    bot.command('start', async (ctx) => {
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
            `Welcome back, <b>${escapeHTML(user.display_name || 'Friend')}</b>! I'm here whenever you need me.\n\n` +
            'Try /briefing for your daily overview, or send me anything on your mind.',
            { parse_mode: 'HTML' }
        );
    });

    bot.command('briefing', async (ctx) => {
        try {
            await sendBriefing(ctx);
        } catch (err) {
            console.error('[/briefing] Error:', err.message);
            await ctx.reply("Couldn't load your briefing right now. Try again in a moment.");
        }
    });

    bot.command('memory', async (ctx) => {
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
            for (const part of parts) {
                await ctx.reply(part, { parse_mode: 'HTML' });
            }
        } catch (err) {
            console.error('[/memory] Error:', err.message);
            await ctx.reply("Couldn't load your items right now.");
        }
    });

    bot.command('help', async (ctx) => {
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
    });

    bot.command('clear', async (ctx) => {
        const sessionId = ctx.flowySessionId;
        if (!sessionId) return ctx.reply('No active session found.');
        try {
            await clearMessages(sessionId);
            await ctx.reply('Chat history cleared. Fresh start!');
        } catch (err) {
            console.error('[/clear] Error:', err.message);
            await ctx.reply("Couldn't clear history right now.");
        }
    });

    bot.command('timezone', async (ctx) => {
        const user = ctx.flowyUser;
        if (!user) return ctx.reply('Something went wrong. Please try /start.');
        const parts = ctx.message.text.split(/\s+/);
        const tz = parts[1];
        if (!tz) {
            return ctx.reply(
                `Your current timezone: <b>${user.timezone || 'not set'}</b>\n\nTo change it:\n<code>/timezone Asia/Kolkata</code>`,
                { parse_mode: 'HTML' }
            );
        }
        try {
            Intl.DateTimeFormat(undefined, { timeZone: tz });
        } catch {
            return ctx.reply(
                `"${escapeHTML(tz)}" isn't a valid timezone.\n\nExamples: <code>Asia/Kolkata</code>, <code>America/New_York</code>, <code>Europe/London</code>`,
                { parse_mode: 'HTML' }
            );
        }
        try {
            await updateUser(user.id, { timezone: tz });
            await ctx.reply(`Timezone updated to <b>${escapeHTML(tz)}</b>`, { parse_mode: 'HTML' });
        } catch (err) {
            console.error('[/timezone] Error:', err.message);
            await ctx.reply("Couldn't update timezone right now.");
        }
    });

    // ── Inline keyboard callbacks ─────────────────
    bot.on('callback_query:data', async (ctx) => {
        const data = ctx.callbackQuery.data;
        const user = ctx.flowyUser;
        if (!user) return ctx.answerCallbackQuery({ text: 'Session expired. Send /start.' });
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
            } else {
                await ctx.answerCallbackQuery({ text: 'Unknown action.' });
            }
        } catch (err) {
            console.error('[Callback] Error:', err.message);
            await ctx.answerCallbackQuery({ text: 'Something went wrong.' });
        }
    });

    // ── Main message handler ──────────────────────
    bot.on('message:text', async (ctx) => {
        const user = ctx.flowyUser;
        const session = ctx.flowySession;
        const sessionId = ctx.flowySessionId;

        if (!user || !sessionId) {
            return ctx.reply('Something went wrong setting up your account. Try /start again.');
        }

        const message = ctx.message.text;
        const userId = user.id;
        const userTimezone = user.timezone || 'UTC';

        await ctx.replyWithChatAction('typing');

        // Refresh typing indicator every 4s so user sees the bot is working
        const typingInterval = setInterval(() => {
            ctx.replyWithChatAction('typing').catch(() => {});
        }, 4000);

        try {
            const now = new Date();
            const currentTime = now.toLocaleDateString('en-US', {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: userTimezone
            }) + ', ' + now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: userTimezone });

            const hasActiveCheckIn = !!(session.check_in_due_at && new Date(session.check_in_due_at) > now);
            const memoryItems = await getMemoryItems(userId);
            const memoryItemsForContext = dedupeMemory(memoryItems);

            let modeContext = '';
            const isOnboarding = (user.onboarding_step ?? 3) < 3;
            if (isOnboarding) {
                modeContext = `TASK: You are continuing onboarding. The user hasn't completed setup yet.
${!user.display_name ? 'Ask for their name.' : !user.main_focus ? `You know their name is ${user.display_name}. Ask what they most want help with.` : `You know their name (${user.display_name}) and focus (${user.main_focus}). Ask what usually gets in their way.`}
Use the update_profile tool to save each answer as they share it.
When you have name, main_focus, and biggest_struggle, give a warm personalized welcome and mark onboarding as done.`;
            }

            await saveMessage(sessionId, 'user', message);

            const rawHistory = await getMessages(sessionId, 8);
            const lastAssistantMessage = [...rawHistory].reverse().find(m => m.role === 'assistant')?.content || null;
            const chatHistory = convertHistory(rawHistory);

            const systemPrompt = buildSystemPrompt({
                userName: user.display_name || 'Friend',
                currentTime,
                timezone: userTimezone,
                memoryItems: memoryItemsForContext,
                activeCheckIn: hasActiveCheckIn,
                checkInDueAt: session.check_in_due_at,
                mainFocus: user.main_focus || null,
                biggestStruggle: user.biggest_struggle || null,
                modeContext,
                lastAssistantMessage,
            });

            const tools = createTools(userId, sessionId, userTimezone, user);
            const model = createTelegramModel(tools);

            let fullText;
            if (!model) {
                fullText = await streamDemoResponse({ onToken: () => {} });
            } else {
                fullText = await streamAgentResponse({
                    model, tools, systemPrompt, chatHistory,
                    userMessage: message,
                    onToken: () => {},
                    onMemoryChanged: async () => {
                        const freshMemory = await getMemoryItems(userId);
                        const freshForContext = dedupeMemory(freshMemory);
                        return buildSystemPrompt({
                            userName: user.display_name || 'Friend',
                            currentTime,
                            timezone: userTimezone,
                            memoryItems: freshForContext,
                            activeCheckIn: hasActiveCheckIn,
                            checkInDueAt: session.check_in_due_at,
                            mainFocus: user.main_focus || null,
                            biggestStruggle: user.biggest_struggle || null,
                            modeContext,
                            lastAssistantMessage,
                        });
                    },
                });
            }

            if (fullText) await saveMessage(sessionId, 'assistant', fullText);

            const html = toTelegramHTML(fullText || "Hey! I'm here. What's on your mind?");
            const parts = splitMessage(html);
            for (const part of parts) {
                await ctx.reply(part, { parse_mode: 'HTML' });
            }
        } catch (err) {
            console.error('[Chat Handler] Error:', err.message);
            if (err.status === 429 || err.message?.includes('rate')) {
                await ctx.reply("Give me a moment...");
                return;
            }
            await ctx.reply("Something went sideways — want to try again? I'm here.");
        } finally {
            clearInterval(typingInterval);
        }
    });

    // Global error handler
    bot.catch((err) => {
        console.error('[Bot] Error:', err.message || err);
    });

    return bot;
}

// ── Briefing helper ───────────────────────────

async function sendBriefing(ctx) {
    const user = ctx.flowyUser;
    const session = ctx.flowySession;
    const sessionId = ctx.flowySessionId;
    const userId = user.id;
    const userTimezone = user.timezone || 'UTC';

    await ctx.replyWithChatAction('typing');

    const cached = await getTodayBriefing(userId);
    if (cached) {
        await updateSession(sessionId, { briefing_delivered: true });
        const html = toTelegramHTML(cached.content);
        for (const part of splitMessage(html)) {
            await ctx.reply(part, { parse_mode: 'HTML' });
        }
        return;
    }

    const now = new Date();
    const currentTime = now.toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: userTimezone
    }) + ', ' + now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: userTimezone });

    const memoryItems = await getMemoryItems(userId);
    const memoryItemsForContext = dedupeMemory(memoryItems);

    const todayStr = now.toLocaleDateString('en-CA', { timeZone: userTimezone });
    const briefingItems = memoryItemsForContext.filter((i) => {
        if (i.category === 'Task') return true;
        if (i.category === 'Reminder') {
            const remindDay = i.remind_at ? new Date(i.remind_at).toLocaleDateString('en-CA', { timeZone: userTimezone }) : null;
            const surfacedDay = i.surfaced_at ? new Date(i.surfaced_at).toLocaleDateString('en-CA', { timeZone: userTimezone }) : null;
            return remindDay === todayStr || surfacedDay === todayStr;
        }
        const capturedDay = i.captured_at ? new Date(i.captured_at).toLocaleDateString('en-CA', { timeZone: userTimezone }) : null;
        return capturedDay === todayStr;
    }).slice(0, 5);

    const itemsList = briefingItems.map((i) => `- [${i.category}] ${i.content}`).join('\n');
    const modeContext = `TASK: Deliver the user's daily briefing.
1. Warm greeting using their name + time of day
2. Mention the current date
3. ${briefingItems.length > 0
        ? `List the top 3 most important items as a markdown bullet list. Prioritize by urgency.\n${itemsList}`
        : 'No saved tasks yet. Ask: "What is the most important thing you need to do today?"'}
4. After the list, on a NEW LINE, ask if they want to start the first one
Keep it brief and energizing.`;

    const systemPrompt = buildSystemPrompt({
        userName: user.display_name || 'Friend',
        currentTime,
        timezone: userTimezone,
        memoryItems: memoryItemsForContext,
        activeCheckIn: false,
        checkInDueAt: null,
        mainFocus: user.main_focus || null,
        biggestStruggle: user.biggest_struggle || null,
        modeContext,
    });

    const tools = createTools(userId, sessionId, userTimezone, user);
    const model = createTelegramModel(tools);

    let fullText;
    if (!model) {
        fullText = "Good morning! Here's your daily check-in. What's the most important thing on your plate today?";
    } else {
        const recentMsgs = await getRecentMessages(userId, 8);
        const chatHistory = convertHistory(recentMsgs);
        fullText = await streamAgentResponse({
            model, tools, systemPrompt, chatHistory,
            userMessage: 'Please proceed with the task described in the system prompt.',
            onToken: () => {},
        });
    }

    await updateSession(sessionId, { briefing_delivered: true });
    if (fullText) await saveTodayBriefing(userId, fullText);

    const html = toTelegramHTML(fullText || "Good morning! What's on your mind today?");
    for (const part of splitMessage(html)) {
        await ctx.reply(part, { parse_mode: 'HTML' });
    }
}
