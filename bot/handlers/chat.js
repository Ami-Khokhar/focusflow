import { buildSystemPrompt, filterForbiddenWords } from '../../lib/langchain/prompts.js';
import { buildGraph, convertHistory, streamDemoResponse, store, writeMemory } from '../../lib/langchain/graph.js';
import { createTools } from '../../lib/langchain/tools.js';
import { tokenize, overlapRatio } from '../../lib/db.js';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import {
    saveMessage,
    getMessages,
    getMemoryItems,
    getRecentMessages,
    updateSession,
    getTodayBriefing,
    saveTodayBriefing,
} from '../../lib/db.js';
import { toTelegramHTML } from '../utils/format.js';
import { splitMessage } from '../utils/message.js';
import { withTimeout } from '../utils/timeout.js';
import { safeReplyParts } from '../utils/safeReply.js';

/**
 * Handle an incoming text message — replicates app/api/chat/route.js logic
 * but collects the full response instead of streaming via SSE.
 */
export async function handleMessage(ctx) {
    const user = ctx.flowyUser;
    const session = ctx.flowySession;
    const sessionId = ctx.flowySessionId;

    if (!user || !sessionId) {
        return ctx.reply('Something went wrong setting up your account. Try /start again.');
    }

    const message = ctx.message.text;
    const userId = user.id;
    const userTimezone = user.timezone || 'UTC';

    // Typing indicator — refresh every 4s so user sees the bot is working
    await ctx.replyWithChatAction('typing');
    const typingInterval = setInterval(() => {
        ctx.replyWithChatAction('typing').catch(() => {});
    }, 4000);

    try {
        // Auto-deliver briefing if not yet delivered today
        const isOnboarding = (user.onboarding_step ?? 3) < 3;
        if (!session.briefing_delivered && !isOnboarding) {
            try { await sendBriefing(ctx); }
            catch (err) { console.error('[Auto-briefing]', err.message); }
        }

        const now = new Date();
        const currentTime = now.toLocaleDateString('en-US', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: userTimezone
        }) + ', ' + now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: userTimezone });

        const hasActiveCheckIn = !!(session.check_in_due_at && new Date(session.check_in_due_at) > now);

        // Load and deduplicate memory items
        const memoryItems = await getMemoryItems(userId);
        const memoryItemsForContext = memoryItems
            .filter((i) => !(i.category === 'Reminder' && i.remind_at && !i.surfaced_at))
            .reduce((acc, item) => {
                const itemTokens = tokenize(item.content);
                const isDup = acc.some((accepted) => overlapRatio(accepted.content, itemTokens) >= 0.8);
                if (!isDup) acc.push(item);
                return acc;
            }, [])
            .slice(0, 15);

        // Detect special modes
        let modeContext = '';
        if (isOnboarding) {
            modeContext = `TASK: You are continuing onboarding. The user hasn't completed setup yet.
${!user.display_name ? 'Ask for their name.' : !user.main_focus ? `You know their name is ${user.display_name}. Ask what they most want help with.` : `You know their name (${user.display_name}) and focus (${user.main_focus}). Ask what usually gets in their way.`}
Use the update_profile tool to save each answer as they share it.
When you have name, main_focus, and biggest_struggle, give a warm personalized welcome and mark onboarding as done.`;
        }

        // Save user message
        await saveMessage(sessionId, 'user', message);

        // Build conversation history
        const rawHistory = await getMessages(sessionId, 8);
        const lastAssistantMessage = [...rawHistory].reverse().find(m => m.role === 'assistant')?.content || null;
        const chatHistory = convertHistory(rawHistory);

        // Build system prompt
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

        // Create tools + graph
        const tools = createTools(userId, sessionId, userTimezone, user, store);
        const graph = buildGraph(tools);

        let fullText;

        if (!graph) {
            // Demo mode
            fullText = await streamDemoResponse({ onToken: () => {} });
        } else {
            const inputMessages = [
                new SystemMessage(systemPrompt),
                ...chatHistory,
                new HumanMessage(message),
            ];
            const result = await withTimeout(
                graph.invoke(
                    { messages: inputMessages },
                    { configurable: { thread_id: sessionId, userId } }
                ),
                25000
            );
            const lastMsg = result.messages[result.messages.length - 1];
            fullText = filterForbiddenWords(
                typeof lastMsg.content === "string" ? lastMsg.content : lastMsg.content?.map(c => c.text || "").join("") || ""
            );
            if (!fullText.trim()) fullText = "Hey! I'm here. What's on your mind?";
        }

        // Save assistant message
        if (fullText) {
            await saveMessage(sessionId, 'assistant', fullText);
            // Fire-and-forget: extract facts from exchange and write to Store
            writeMemory(message, fullText, userId, store)
                .catch(e => console.warn("[WriteMemory] Background extraction failed:", e.message));
        }

        // Format and send
        const html = toTelegramHTML(fullText || "Hey! I'm here. What's on your mind?");
        const parts = splitMessage(html);
        await safeReplyParts(ctx, parts);

    } catch (err) {
        if (err.message === 'TIMEOUT') {
            await ctx.reply("I'm taking too long — try again?");
            return;
        }

        console.error('[Chat Handler] Error:', err.message);

        // Rate limit retry
        if (err.status === 429 || err.message?.includes('rate')) {
            await ctx.reply("Give me a moment...");
            return;
        }

        await ctx.reply("Something went sideways — want to try again? I'm here.");
    } finally {
        clearInterval(typingInterval);
    }
}

/**
 * Send a briefing message to a Telegram chat (used by commands and cron).
 */
export async function sendBriefing(ctx) {
    const user = ctx.flowyUser;
    const session = ctx.flowySession;
    const sessionId = ctx.flowySessionId;
    const userId = user.id;
    const userTimezone = user.timezone || 'UTC';

    await ctx.replyWithChatAction('typing');

    // Check for cached briefing
    const cached = await getTodayBriefing(userId);
    if (cached) {
        await updateSession(sessionId, { briefing_delivered: true });
        const html = toTelegramHTML(cached.content);
        const parts = splitMessage(html);
        await safeReplyParts(ctx, parts);
        return;
    }

    const now = new Date();
    const currentTime = now.toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: userTimezone
    }) + ', ' + now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: userTimezone });

    const memoryItems = await getMemoryItems(userId);
    const memoryItemsForContext = memoryItems
        .filter((i) => !(i.category === 'Reminder' && i.remind_at && !i.surfaced_at))
        .reduce((acc, item) => {
            const itemTokens = tokenize(item.content);
            const isDup = acc.some((accepted) => overlapRatio(accepted.content, itemTokens) >= 0.8);
            if (!isDup) acc.push(item);
            return acc;
        }, [])
        .slice(0, 15);

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

    const tools = createTools(userId, sessionId, userTimezone, user, store);
    const graph = buildGraph(tools);

    let fullText;
    if (!graph) {
        fullText = "Good morning! Here's your daily check-in. What's the most important thing on your plate today?";
    } else {
        const recentMsgs = await getRecentMessages(userId, 20);
        const chatHistory = convertHistory(recentMsgs);
        const inputMessages = [
            new SystemMessage(systemPrompt),
            ...chatHistory,
            new HumanMessage('Please proceed with the task described in the system prompt.'),
        ];
        const result = await withTimeout(
            graph.invoke(
                { messages: inputMessages },
                { configurable: { thread_id: sessionId, userId } }
            ),
            25000
        );
        const lastMsg = result.messages[result.messages.length - 1];
        fullText = filterForbiddenWords(
            typeof lastMsg.content === "string" ? lastMsg.content : lastMsg.content?.map(c => c.text || "").join("") || ""
        );
    }

    await updateSession(sessionId, { briefing_delivered: true });
    if (fullText) await saveTodayBriefing(userId, fullText);

    const html = toTelegramHTML(fullText || "Good morning! What's on your mind today?");
    const parts = splitMessage(html);
    await safeReplyParts(ctx, parts);
}
