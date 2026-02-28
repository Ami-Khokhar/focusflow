// POST /api/chat — streaming chat endpoint
import { buildSystemPrompt, detectIntent, detectCheckInAcceptance } from '@/lib/prompts';
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
} from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(request) {
    try {
        const { message, sessionId, userId, userName, mode: requestMode } = await request.json();

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

        // For normal chat messages, detect intent
        if (mode === 'chat' && message !== '__MORNING_BRIEFING__' && message !== '__ONBOARDING__') {
            const intent = detectIntent(message);
            if (intent !== 'general') {
                mode = intent;
            }

            // Save user message to DB
            await saveMessage(sessionId, 'user', message);
        }

        // Get memory items for context
        const memoryItems = await getMemoryItems(userId);

        // Handle memory capture (with time parsing)
        if (mode === 'memory_capture') {
            // Extract the thing to remember from the message
            let content = message
                .replace(/remind me (to |about )?/i, '')
                .replace(/remember (this|that)?:?\s*/i, '')
                .replace(/note (this|that)?:?\s*/i, '')
                .replace(/save (this|that)?:?\s*/i, '')
                .replace(/don't let me forget (to |about )?/i, '')
                .trim();

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

        // Mark briefing as delivered
        if (mode === 'briefing') {
            await updateSession(sessionId, { briefing_delivered: true });
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

        // Build conversation history (last 20 messages)
        const history = await getMessages(sessionId, 20);
        const conversationHistory = history.map((msg) => ({
            role: msg.role,
            content: msg.content,
        }));

        // Detect check-in acceptance (user said "yes" to a check-in offer)
        if (mode === 'chat' || mode === 'general') {
            const isCheckInAcceptance = detectCheckInAcceptance(conversationHistory, message);
            if (isCheckInAcceptance) {
                const checkInDueAt = new Date(Date.now() + 25 * 60 * 1000).toISOString();
                await updateSession(sessionId, { check_in_due_at: checkInDueAt });
                mode = 'check_in_set';
            }
        }

        // Check for active check-in timer (to prevent premature check-ins)
        const currentSession = await getOrCreateSession(userId);
        const hasActiveCheckIn = !!(currentSession.check_in_due_at && new Date(currentSession.check_in_due_at) > new Date());

        // Build system prompt
        const now = new Date();
        const promptMode = (mode === 'memory_capture' || mode === 'memory_recall' || mode === 'memory_delete' || mode === 'decomposition')
            ? 'chat'
            : mode;
        const systemPrompt = buildSystemPrompt({
            userName: userName || 'Friend',
            currentTime: now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            mode: promptMode,
            memoryItems: await getMemoryItems(userId),
            activeCheckIn: hasActiveCheckIn,
            checkInDueAt: currentSession.check_in_due_at,
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
                        userName: userName || 'Friend',
                        memoryItems: await getMemoryItems(userId),
                        userMessage,
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
        return new Response(JSON.stringify({ error: 'Internal server error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
