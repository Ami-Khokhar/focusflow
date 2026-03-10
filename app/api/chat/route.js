// POST /api/chat — streaming chat endpoint (LangChain tool-calling agent)
import { buildSystemPrompt } from '@/lib/langchain/prompts';
import { createModel, convertHistory } from '@/lib/langchain/agent';
import { createTools } from '@/lib/langchain/tools';
import { streamAgentResponse, streamDemoResponse } from '@/lib/langchain/streaming';
import { createSupabaseServerClient, supabaseAdmin, isDemoMode } from '@/lib/supabase';
import {
    getMessages,
    saveMessage,
    getMemoryItems,
    updateSession,
    getOrCreateSession,
    getTodayBriefing,
    saveTodayBriefing,
    getRecentMessages,
    getUser,
} from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(request) {
    try {
        const body = await request.json();
        const { message, sessionId, userName, mode: requestMode, timezone, clientHistory, content } = body;
        let userId = body.userId;

        // ── Auth ──────────────────────────────────────────────
        const isTestMode = process.env.TEST_MODE === 'true' &&
            request.headers.get('authorization') === `Bearer ${process.env.TEST_TOKEN}`;

        if (!isDemoMode && !isTestMode) {
            const supabase = createSupabaseServerClient(request);
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
            const { data: appUser, error } = await supabaseAdmin
                .from('users').select('id').eq('auth_user_id', user.id).maybeSingle();
            if (error || !appUser) return Response.json({ error: 'User not found' }, { status: 404 });
            userId = appUser.id;
        }

        if (!sessionId || !userId) return Response.json({ error: 'Missing sessionId or userId' }, { status: 400 });

        // ── Proactive save (fire-and-forget, no LLM needed) ───
        if (requestMode === 'proactive_save') {
            if (content && typeof content === 'string' && content.length <= 5000) {
                await saveMessage(sessionId, 'assistant', content);
            }
            return Response.json({ ok: true });
        }

        // ── Load user + session state ─────────────────────────
        const user = await getUser(userId);
        const currentSession = await getOrCreateSession(userId);
        const userTimezone = timezone || user?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
        const now = new Date();
        const currentTime = now.toLocaleDateString('en-US', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: userTimezone
        }) + ', ' + now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: userTimezone });

        const hasActiveCheckIn = !!(currentSession.check_in_due_at && new Date(currentSession.check_in_due_at) > now);
        const memoryItems = await getMemoryItems(userId);
        // Deduplicate by normalized content (keep most recent) and cap at 15 items
        const _normKey = (s) => (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
        const _seen = new Set();
        const memoryItemsForContext = memoryItems
            .filter((i) => !(i.category === 'Reminder' && i.remind_at && !i.surfaced_at))
            .filter((i) => { const k = _normKey(i.content); if (_seen.has(k)) return false; _seen.add(k); return true; })
            .slice(0, 15);

        // ── Detect special modes from session state ───────────
        let modeContext = '';
        let isBriefing = false;
        let isCheckIn = false;
        let isOnboarding = (user?.onboarding_step ?? 3) < 3;

        if (message === '__MORNING_BRIEFING__' || requestMode === 'briefing') {
            isBriefing = true;
            await updateSession(sessionId, { briefing_delivered: true });

            // Serve cached briefing if available
            const cached = await getTodayBriefing(userId);
            if (cached) {
                const encoder = new TextEncoder();
                const stream = new ReadableStream({
                    start(controller) {
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token: cached.content })}\n\n`));
                        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                        controller.close();
                    },
                });
                return new Response(stream, {
                    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
                });
            }

            // Filter to today-relevant items for briefing
            const todayStr = now.toLocaleDateString('en-CA', { timeZone: userTimezone }); // YYYY-MM-DD
            const briefingItems = memoryItemsForContext.filter((i) => {
                // Tasks are always relevant (uncompleted work)
                if (i.category === 'Task') return true;
                // Reminders: only if remind_at or surfaced_at is today
                if (i.category === 'Reminder') {
                    const remindDay = i.remind_at ? new Date(i.remind_at).toLocaleDateString('en-CA', { timeZone: userTimezone }) : null;
                    const surfacedDay = i.surfaced_at ? new Date(i.surfaced_at).toLocaleDateString('en-CA', { timeZone: userTimezone }) : null;
                    return remindDay === todayStr || surfacedDay === todayStr;
                }
                // Notes/Ideas/Links: only if created today
                const capturedDay = i.captured_at ? new Date(i.captured_at).toLocaleDateString('en-CA', { timeZone: userTimezone }) : null;
                return capturedDay === todayStr;
            }).slice(0, 5);
            const itemsList = briefingItems.map((i) => `- [${i.category}] ${i.content}`).join('\n');
            modeContext = `TASK: Deliver the user's daily briefing.
1. Warm greeting using their name + time of day
2. Mention the current date
3. ${briefingItems.length > 0
    ? `List the top 3 most important items as a markdown bullet list. Prioritize by urgency.\n${itemsList}`
    : 'No saved tasks yet. Ask: "What is the most important thing you need to do today?"'}
4. After the list, on a NEW LINE, ask if they want to start the first one
Keep it brief and energizing.`;

        } else if (requestMode === 'check_in') {
            isCheckIn = true;
            await updateSession(sessionId, { check_in_due_at: null });
            modeContext = `TASK: Deliver a gentle 25-minute check-in.
- Be warm: "Hey! It's been about 25 minutes."
- Ask how it's going — ONE question
- Offer three paths: keep going, take a break, or try something different
- If they didn't finish, respond with ACCEPTANCE, never disappointment
- Keep it under 40 words`;

        } else if (isOnboarding && (message === '__ONBOARDING__' || requestMode === 'onboarding')) {
            modeContext = `TASK: You are greeting a brand new user for the very first time.
Ask for their name warmly in 1-2 sentences. Don't list features yet.
Example: "Hey! Welcome to Flowy. Before we dive in — what should I call you?"
When they reply with their name, use the update_profile tool to save it, then ask what they most want help with.
Continue naturally until you have their name, main focus, and biggest struggle — then give a warm personalized welcome.`;

        } else if (isOnboarding) {
            modeContext = `TASK: You are continuing onboarding. The user hasn't completed setup yet.
${!user?.display_name ? 'Ask for their name.' : !user?.main_focus ? `You know their name is ${user.display_name}. Ask what they most want help with.` : `You know their name (${user.display_name}) and focus (${user.main_focus}). Ask what usually gets in their way.`}
Use the update_profile tool to save each answer as they share it.
When you have name, main_focus, and biggest_struggle, give a warm personalized welcome and mark onboarding as done.`;
        }

        // ── Save user message ─────────────────────────────────
        if (message && message !== '__MORNING_BRIEFING__' && message !== '__ONBOARDING__') {
            await saveMessage(sessionId, 'user', message);
        }

        // ── Build conversation history ────────────────────────
        const rawHistory = isBriefing
            ? await getRecentMessages(userId, 8)
            : await getMessages(sessionId, 8);
        let historyToUse = rawHistory.length > 0 ? rawHistory : (clientHistory || []);

        const lastAssistantMessage = [...historyToUse].reverse().find(m => m.role === 'assistant')?.content || null;

        // Convert to LangChain message objects
        const chatHistory = convertHistory(historyToUse);

        // ── Build system prompt ───────────────────────────────
        const systemPrompt = buildSystemPrompt({
            userName: user?.display_name || userName || 'Friend',
            currentTime,
            timezone: userTimezone,
            memoryItems: memoryItemsForContext,
            activeCheckIn: hasActiveCheckIn,
            checkInDueAt: currentSession.check_in_due_at,
            mainFocus: user?.main_focus || null,
            biggestStruggle: user?.biggest_struggle || null,
            modeContext,
            lastAssistantMessage,
        });

        // ── Create tools + model ──────────────────────────────
        const tools = createTools(userId, sessionId, userTimezone, user);
        const model = createModel(tools);

        // ── Determine effective user message for the agent ────
        const effectiveMessage = (message === '__MORNING_BRIEFING__' || message === '__ONBOARDING__')
            ? (modeContext ? 'Please proceed with the task described in the system prompt.' : 'Hello!')
            : (message || 'Hello!');

        const encoder = new TextEncoder();

        const stream = new ReadableStream({
            async start(controller) {
                try {
                    let fullText;

                    if (!model) {
                        // Demo mode
                        fullText = await streamDemoResponse({
                            onToken: (token) => {
                                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token })}\n\n`));
                            },
                        });
                    } else {
                        // LangChain model with native tool calling
                        fullText = await streamAgentResponse({
                            model,
                            tools,
                            systemPrompt,
                            chatHistory,
                            userMessage: effectiveMessage,
                            onToken: (token) => {
                                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token })}\n\n`));
                            },
                            onMemoryChanged: async () => {
                                const freshMemory = await getMemoryItems(userId);
                                const _norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
                                const _s = new Set();
                                const freshForContext = freshMemory
                                    .filter((i) => !(i.category === 'Reminder' && i.remind_at && !i.surfaced_at))
                                    .filter((i) => { const k = _norm(i.content); if (_s.has(k)) return false; _s.add(k); return true; })
                                    .slice(0, 15);
                                return buildSystemPrompt({
                                    userName: user?.display_name || userName || 'Friend',
                                    currentTime,
                                    timezone: userTimezone,
                                    memoryItems: freshForContext,
                                    activeCheckIn: hasActiveCheckIn,
                                    checkInDueAt: currentSession.check_in_due_at,
                                    mainFocus: user?.main_focus || null,
                                    biggestStruggle: user?.biggest_struggle || null,
                                    modeContext,
                                    lastAssistantMessage,
                                });
                            },
                        });
                    }

                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                    controller.close();

                    // ── Save assistant response ───────────────
                    if (fullText) {
                        await saveMessage(sessionId, 'assistant', fullText);
                        if (isBriefing) await saveTodayBriefing(userId, fullText);
                    }
                } catch (error) {
                    console.error('[Chat API] Streaming error:', error);
                    try {
                        const errMsg = "Something went sideways — want to try again? I'm here.";
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token: errMsg })}\n\n`));
                        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                        controller.close();
                    } catch {
                        // Controller already closed — ignore
                    }
                }
            },
        });

        return new Response(stream, {
            headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
        });

    } catch (error) {
        console.error('[Chat API] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
}
