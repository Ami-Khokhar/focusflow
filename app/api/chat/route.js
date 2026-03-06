// POST /api/chat — streaming chat endpoint
import { buildSystemPrompt, detectIntent, detectCheckInAcceptance, classifyIntentWithLLM } from '@/lib/prompts';
import { streamChatResponse } from '@/lib/llm';
import { parseRemindTime, parseTimeOffset } from '@/lib/timeParser';
import {
    getMessages,
    saveMessage,
    saveMemoryItem,
    deleteLastMemoryItem,
    getMemoryItems,
    updateSession,
    getOrCreateSession,
    rescheduleLastReminder,
    getTodayBriefing,
    saveTodayBriefing,
    getRecentMessages,
    getUser,
    updateUser,
    markMemoryItemDone,
    findMemoryItemByContent,
} from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(request) {
    try {
        const { message, sessionId, userId, userName, mode: requestMode, timezone, clientHistory } = await request.json();

        if (!sessionId || !userId) {
            return new Response(JSON.stringify({ error: 'Missing sessionId or userId' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Determine the mode
        let mode = requestMode || 'chat';
        let userMessage = message;
        let remindAt = null;

        // ── Onboarding flow ──────────────────────────────────
        // Check if user still needs onboarding (step 0–2).
        // Step 0 + mode='onboarding' → send Q1 (no answer to process yet)
        // Step 1+ + mode='chat'     → user is answering the previous question
        const user = await getUser(userId);
        const onboardingStep = user?.onboarding_step ?? 3; // default 3 = complete

        if (onboardingStep < 3) {
            if (mode === 'onboarding' && onboardingStep === 0) {
                // Initial trigger — just ask Q1, no user answer to save
                mode = 'onboarding_q1';
            } else if (mode === 'chat') {
                // User is answering an onboarding question
                await saveMessage(sessionId, 'user', message);

                if (onboardingStep === 0) {
                    // Answer to Q1: save their name
                    const name = message.trim().replace(/^(i'm |my name is |call me |it's |i am )/i, '').replace(/[.!]+$/, '').trim();
                    await updateUser(userId, { display_name: name, onboarding_step: 1 });
                    mode = 'onboarding_q2';
                } else if (onboardingStep === 1) {
                    // Answer to Q2: save main focus
                    await updateUser(userId, { main_focus: message.trim(), onboarding_step: 2 });
                    mode = 'onboarding_q3';
                } else if (onboardingStep === 2) {
                    // Answer to Q3: save biggest struggle, mark onboarding complete
                    await updateUser(userId, { biggest_struggle: message.trim(), onboarding_step: 3 });
                    mode = 'onboarding_done';
                }
            }
        }

        // For normal chat messages, detect intent
        if (mode === 'chat' && message !== '__MORNING_BRIEFING__' && message !== '__ONBOARDING__') {
            // Save user message before intent detection (history is used for check-in context)
            await saveMessage(sessionId, 'user', message);

            // LLM is the primary classifier; regex is the fallback for demo mode / API failure
            let intent = null;

            // Guard: short acknowledgments must never be misclassified as memory_capture
            // or reminder_reschedule — they are always general conversation.
            const isAcknowledgment = /^(ok|okay|sure|thanks|thank you|got it|will do|sounds good|great|perfect|nice|cool|yep|yeah|yes|alright|noted|done|understood|k|kk)[\s.!,?]*$/i.test(message.trim());

            if (!isAcknowledgment) {
                intent = detectIntent(message);
                // Regex is confident for clear patterns; use LLM only for ambiguous messages
                if (intent === 'general') {
                    const classifierKey = process.env.GROQ_API_KEY_2 || process.env.GROQ_API_KEY;
                    const llmIntent = await classifyIntentWithLLM(message, classifierKey, clientHistory || []);
                    if (llmIntent) intent = llmIntent;
                }
            }

            if (intent !== 'general') {
                mode = intent;
            }
        }

        // Get memory items for context
        const memoryItems = await getMemoryItems(userId);
        // Hide pending timed reminders from the LLM — they are delivered by the system,
        // not by the LLM. Showing them causes the LLM to narrate countdowns and statuses.
        const memoryItemsForLLM = memoryItems.filter(
            (i) => !(i.category === 'Reminder' && i.remind_at && !i.surfaced_at)
        );

        // Handle memory capture (with time parsing)
        if (mode === 'memory_capture') {
            // Extract the thing to remember — capture what comes AFTER the trigger phrase
            // (simple .replace() leaves any text before the trigger, e.g. "no, remind me to X" → "no, X")
            const triggerMatch = message.match(
                /(?:remind me(?:\s+(?:to|about))?|i\s+(?:need|want)\s+to\s+remember|remember\s+(?:this|that|to)?:?|note\s+(?:this|that|down)?:?|save\s+(?:this|that)?:?|don't\s+let\s+me\s+forget\s+(?:to|about)?|keep\s+(?:a\s+)?(?:note|track)\s+of)\s+([\s\S]+)/i
            );
            let content = triggerMatch ? triggerMatch[1].trim() : message.trim();

            // Parse time expression from the content
            const parsed = parseRemindTime(content);
            content = parsed.content;
            remindAt = parsed.remindAt;

            if (content) {
                // Auto-categorize
                let category = 'Note';
                const lower = content.toLowerCase();
                if (remindAt) {
                    category = 'Reminder';
                } else if (/call |email |submit |finish |complete |do |make |write |send |buy |get /i.test(lower)) {
                    category = 'Task';
                } else if (/remind|reminder|appointment|meeting/i.test(lower)) {
                    category = 'Reminder';
                } else if (/http|www\.|\.com|\.org|\.io/i.test(lower)) {
                    category = 'Link';
                } else if (/idea|what if|maybe|could/i.test(lower)) {
                    category = 'Idea';
                }

                await saveMemoryItem(userId, content, category, remindAt);
                userMessage = content;

                // If a time was parsed, switch to reminder_set mode for confirmation
                if (remindAt) {
                    mode = 'reminder_set';
                }
            }
        }

        // Handle memory delete
        if (mode === 'memory_delete') {
            await deleteLastMemoryItem(userId);
        }

        // Handle task completion — find and mark the task done
        if (mode === 'task_complete') {
            const task = await findMemoryItemByContent(userId, message);
            if (task) {
                await markMemoryItemDone(userId, task.id);
                userMessage = task.content;
            }
        }

        // Handle reminder reschedule
        if (mode === 'reminder_reschedule') {
            const offsetMs = parseTimeOffset(message);
            if (offsetMs) {
                const newRemindAt = new Date(Date.now() + offsetMs).toISOString();
                const updated = await rescheduleLastReminder(userId, newRemindAt);
                if (updated) {
                    userMessage = updated.content;
                    remindAt = newRemindAt;
                }
            }
            mode = 'reminder_set'; // Reuse reminder_set confirmation response
        }

        // Briefing: serve cached version if it exists (avoids regenerating every page refresh)
        if (mode === 'briefing') {
            await updateSession(sessionId, { briefing_delivered: true });
            const cached = await getTodayBriefing(userId);
            if (cached) {
                // Stream the cached briefing back token-by-token
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
        }

        // Handle check-in trigger — clear the timer so it doesn't re-fire
        if (mode === 'check_in') {
            await updateSession(sessionId, { check_in_due_at: null });
        }

        // Handle proactive message save (fire-and-forget from client polling)
        if (mode === 'proactive_save') {
            return new Response(JSON.stringify({ ok: true }), {
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Build conversation history
        // For briefing: use cross-session recent messages for richer context
        // For chat: use current session messages only
        const history = mode === 'briefing'
            ? await getRecentMessages(userId, 20)
            : await getMessages(sessionId, 20);
        // Fallback to client-provided history when the server-side store is empty
        // (happens in demo mode on Vercel serverless where global store resets between invocations)
        let historyToUse = history.length > 0 ? history : (clientHistory || []);

        // Session reset: if there's a goodbye/farewell in recent history, only keep messages after it
        // This prevents the LLM from pattern-matching old "Anytime!" responses when user says "hi" again
        const goodbyePattern = /\b(bye|goodbye|see you|take care|talk later|i'm off|farewell|anytime|let me know)\b/i;
        let lastGoodbyeIndex = -1;
        for (let i = historyToUse.length - 1; i >= 0; i--) {
            if (goodbyePattern.test(historyToUse[i].content)) {
                lastGoodbyeIndex = i;
                break;
            }
        }
        // If there was a goodbye, and user now says "hi"/"hey"/"hello", reset context to messages after goodbye
        if (lastGoodbyeIndex >= 0 && /^(hi|hey|hello|i'm back|i'm here)[\s.!,?]*$/i.test(message.trim())) {
            historyToUse = historyToUse.slice(lastGoodbyeIndex + 1);
        }

        const conversationHistory = historyToUse.map((msg) => ({ role: msg.role, content: msg.content }));

        // Handle check-in acceptance — can come from LLM classifier or legacy regex
        const isCheckInAcceptance =
            mode === 'check_in_acceptance' ||
            ((mode === 'chat' || mode === 'general') &&
                detectCheckInAcceptance(conversationHistory, message));
        if (isCheckInAcceptance) {
            const checkInDueAt = new Date(Date.now() + 25 * 60 * 1000).toISOString();
            await updateSession(sessionId, { check_in_due_at: checkInDueAt });
            mode = 'check_in_set';
        }

        // Check for active check-in timer (to prevent premature check-ins)
        const currentSession = await getOrCreateSession(userId);
        const hasActiveCheckIn = !!(currentSession.check_in_due_at && new Date(currentSession.check_in_due_at) > new Date());

        // Build system prompt
        const now = new Date();
        const userTimezone = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
        const promptMode = (mode === 'memory_recall' || mode === 'memory_delete' || mode === 'decomposition')
            ? 'chat'
            : mode;
        // Re-fetch user for latest name/focus/struggle (may have been updated during onboarding)
        const freshUser = (onboardingStep < 3) ? await getUser(userId) : user;
        const displayName = freshUser?.display_name || userName || 'Friend';

        const systemPrompt = buildSystemPrompt({
            userName: displayName,
            currentTime: now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: userTimezone }) + ', ' + now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: userTimezone }),
            timezone: userTimezone,
            mode: promptMode,
            memoryItems: memoryItemsForLLM,
            activeCheckIn: hasActiveCheckIn,
            checkInDueAt: currentSession.check_in_due_at,
            remindAt,
            userMessage,
            mainFocus: freshUser?.main_focus || null,
            biggestStruggle: freshUser?.biggest_struggle || null,
        });

        // Create a streaming response
        const encoder = new TextEncoder();
        let fullResponse = '';

        const stream = new ReadableStream({
            async start(controller) {
                try {
                    fullResponse = await streamChatResponse({
                        systemPrompt,
                        conversationHistory,
                        mode,
                        userName: displayName,
                        memoryItems: memoryItemsForLLM,
                        userMessage: message,
                        remindAt,
                        onToken: (token) => {
                            const data = `data: ${JSON.stringify({ token })}\n\n`;
                            controller.enqueue(encoder.encode(data));
                        },
                    });

                    // Send done signal
                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                    controller.close();

                    // Save assistant response to DB (after stream completes)
                    if (fullResponse) {
                        await saveMessage(sessionId, 'assistant', fullResponse);
                        // Cache the briefing so it's not regenerated on refresh
                        if (mode === 'briefing') {
                            await saveTodayBriefing(userId, fullResponse);
                        }
                    }
                } catch (error) {
                    console.error('Streaming error:', error);
                    const errorMsg = "Something went sideways — want to try again? I'm here. 🔄";
                    controller.enqueue(
                        encoder.encode(`data: ${JSON.stringify({ token: errorMsg })}\n\n`)
                    );
                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                    controller.close();
                }
            },
        });

        return new Response(stream, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
            },
        });
    } catch (error) {
        console.error('Chat API error:', error);
        return new Response(JSON.stringify({ error: error.message, stack: error.stack }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
