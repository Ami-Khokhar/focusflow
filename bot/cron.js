import cron from 'node-cron';
import { InlineKeyboard } from 'grammy';
import {
    getAllDueReminders,
    markReminderSurfaced,
    getAllSessionsWithDueCheckIns,
    updateSession,
    getUser,
    getMemoryItems,
} from '../lib/db.js';
import { buildSystemPrompt, filterForbiddenWords } from '../lib/langchain/prompts.js';
import { buildGraph, convertHistory, store } from '../lib/langchain/graph.js';
import { createTools } from '../lib/langchain/tools.js';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { escapeHTML, toTelegramHTML } from './utils/format.js';
import { splitMessage } from './utils/message.js';
import { withTimeout } from './utils/timeout.js';
import { safeSendMessage } from './utils/safeReply.js';

export function startCronJobs(bot) {
    // Every 60 seconds: scan for due reminders
    cron.schedule('* * * * *', () => processReminders(bot));

    // Every 60 seconds: scan for due check-ins
    cron.schedule('* * * * *', () => processCheckIns(bot));

    console.log('[Cron] Reminder + check-in jobs started (every 60s)');
}

async function processReminders(bot) {
    try {
        const dueReminders = await getAllDueReminders();
        if (!dueReminders.length) return;

        for (const item of dueReminders) {
            try {
                const user = await getUser(item.user_id);
                if (!user?.telegram_id) continue;

                await markReminderSurfaced(item.user_id, item.id);

                const keyboard = new InlineKeyboard()
                    .text('Keep as note', `keep:${item.id}`)
                    .text('Dismiss', `dismiss:${item.id}`);

                await safeSendMessage(
                    bot.api,
                    user.telegram_id,
                    `Hey! You asked me to remind you:\n\n<b>${escapeHTML(item.content)}</b>`,
                    { reply_markup: keyboard }
                );
            } catch (err) {
                console.error(`[Cron] Failed to deliver reminder ${item.id}:`, err.message);
            }
        }
    } catch (err) {
        console.error('[Cron] processReminders error:', err.message);
    }
}

async function processCheckIns(bot) {
    try {
        const dueCheckIns = await getAllSessionsWithDueCheckIns();
        if (!dueCheckIns.length) return;

        for (const { session, user } of dueCheckIns) {
            try {
                if (!user.telegram_id) continue;

                // Clear the check-in timer first to avoid re-delivery
                await updateSession(session.id, { check_in_due_at: null });

                const userTimezone = user.timezone || 'UTC';
                const now = new Date();
                const currentTime = now.toLocaleDateString('en-US', {
                    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: userTimezone
                }) + ', ' + now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: userTimezone });

                const modeContext = `TASK: Deliver a gentle 25-minute check-in.
- Be warm: "Hey! It's been about 25 minutes."
- Ask how it's going — ONE question
- Offer three paths: keep going, take a break, or try something different
- If they didn't finish, respond with ACCEPTANCE, never disappointment
- Keep it under 40 words`;

                const memoryItems = await getMemoryItems(user.id);
                const systemPrompt = buildSystemPrompt({
                    userName: user.display_name || 'Friend',
                    currentTime,
                    timezone: userTimezone,
                    memoryItems: memoryItems.slice(0, 10),
                    activeCheckIn: false,
                    checkInDueAt: null,
                    mainFocus: user.main_focus || null,
                    biggestStruggle: user.biggest_struggle || null,
                    modeContext,
                });

                const tools = createTools(user.id, session.id, userTimezone, user, store);
                const graph = buildGraph(tools);

                let checkInText;
                if (!graph) {
                    checkInText = "Hey! It's been about 25 minutes. How's it going? Want to keep going, take a break, or try something different?";
                } else {
                    const inputMessages = [
                        new SystemMessage(systemPrompt),
                        new HumanMessage('Please proceed with the task described in the system prompt.'),
                    ];
                    const result = await withTimeout(
                        graph.invoke(
                            { messages: inputMessages },
                            { configurable: { thread_id: session.id, userId: user.id } }
                        ),
                        25000
                    );
                    const lastMsg = result.messages[result.messages.length - 1];
                    checkInText = filterForbiddenWords(
                        typeof lastMsg.content === "string" ? lastMsg.content : lastMsg.content?.map(c => c.text || "").join("") || ""
                    );
                    if (!checkInText.trim()) checkInText = "Hey! It's been about 25 minutes. How's it going?";
                }

                const html = toTelegramHTML(checkInText);
                const parts = splitMessage(html);
                for (const part of parts) {
                    await safeSendMessage(bot.api, user.telegram_id, part);
                }
            } catch (err) {
                if (err.message === 'TIMEOUT') {
                    console.error(`[Cron] Check-in timed out for session ${session.id}`);
                } else {
                    console.error(`[Cron] Failed to deliver check-in for session ${session.id}:`, err.message);
                }
            }
        }
    } catch (err) {
        console.error('[Cron] processCheckIns error:', err.message);
    }
}
