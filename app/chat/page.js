'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import { parseRemindTime } from '@/lib/timeParser';

// Convert a base64url VAPID public key to a Uint8Array for PushManager.subscribe()
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

// Supabase client for Realtime (NEXT_PUBLIC_ vars are safe in browser)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const isSupabaseMode = !!(supabaseUrl && supabaseKey);

export default function ChatPage() {
    const router = useRouter();
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [sessionId, setSessionId] = useState(null);
    const [userName, setUserName] = useState('Friend');
    const messagesEndRef = useRef(null);
    const textareaRef = useRef(null);
    const initializedRef = useRef(false);
    const isLoadingRef = useRef(false); // ref mirror for polling to read
    const briefingDoneRef = useRef(false); // prevents reminders from surfacing before briefing

    const userId =
        typeof window !== 'undefined'
            ? localStorage.getItem('focusflow_user_id')
            : null;

    // Keep ref in sync with state (so polling can read without stale closures)
    useEffect(() => {
        isLoadingRef.current = isLoading;
    }, [isLoading]);

    // Scroll to bottom of messages
    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, []);

    useEffect(() => {
        scrollToBottom();
    }, [messages, scrollToBottom]);

    // Auto-resize textarea
    useEffect(() => {
        const ta = textareaRef.current;
        if (ta) {
            ta.style.height = 'auto';
            ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
        }
    }, [input]);

    // Initialize session
    useEffect(() => {
        if (!userId) {
            router.push('/');
            return;
        }
        if (initializedRef.current) return;
        initializedRef.current = true;

        const name = localStorage.getItem('focusflow_user_name') || 'Friend';
        setUserName(name);

        async function init() {
            try {
                const res = await fetch(`/api/session?userId=${userId}`);
                const session = await res.json();
                setSessionId(session.id);

                // Use server-side name if onboarding already captured it
                if (session.display_name && session.display_name !== 'Friend') {
                    setUserName(session.display_name);
                    localStorage.setItem('focusflow_user_name', session.display_name);
                }

                // Load existing messages
                if (session.messages && session.messages.length > 0) {
                    setMessages(session.messages);
                }

                // Onboarding takes priority: if user hasn't completed 3 questions, start onboarding
                const onboardingStep = session.onboarding_step ?? 3;
                if (onboardingStep < 3 && (!session.messages || session.messages.length === 0)) {
                    await sendSystemMessage(session.id, name, false, 'onboarding');
                } else if (!session.messages || session.messages.length === 0 || !session.briefing_delivered) {
                    // Send briefing if not yet delivered today
                    await sendSystemMessage(session.id, session.display_name || name, session.briefing_delivered);
                }

                // Only check for due reminders AFTER the briefing/greeting is shown.
                // This prevents stale overnight reminders from racing with and hijacking the briefing.
                briefingDoneRef.current = true;
                await checkProactiveMessages();
            } catch {
                // Fallback: still create a session even if API fails
                setSessionId('demo-session');
                await sendSystemMessage('demo-session', name, false);
                briefingDoneRef.current = true;
            }
        }

        init();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId, router]);

    // ────────────────────────────────────────────
    //  Proactive message delivery (reminders + check-ins)
    //  Supabase mode: Realtime subscription (instant) + fallback poll
    //  Demo mode: polling only
    // ────────────────────────────────────────────

    // Deduplication persisted in sessionStorage — survives page reloads and React re-renders
    // Clears only when the tab is actually closed (appropriate boundary for a session)
    // Initialize empty, then hydrate from sessionStorage in useEffect (client-side only)
    const deliveredReminderIds = useRef(new Set());
    const deliveredCheckInKeys = useRef(new Set());

    // Shared handler — called by both Realtime and polling paths
    const handleDueReminder = useCallback((reminder) => {
        if (deliveredReminderIds.current.has(reminder.id)) return;
        deliveredReminderIds.current.add(reminder.id);
        // Persist so page refreshes don't re-fire the same reminder
        sessionStorage.setItem(
            'ff_delivered_reminders',
            JSON.stringify([...deliveredReminderIds.current])
        );
        const content = `**Reminder:** ${reminder.content}\n\n_(This was something you asked me to hold onto.)_`;
        setMessages((prev) => [...prev, { role: 'assistant', content }]);
        saveProactiveMessage(content);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Hoist checkProactiveMessages so it can be shared with the visibility listener
    const checkProactiveMessages = useCallback(async () => {
        // Never surface reminders before the briefing has been shown — avoids overnight
        // reminders hijacking the morning greeting.
        if (!briefingDoneRef.current) return;
        try {
            const res = await fetch(`/api/reminders?userId=${userId}`);
            const data = await res.json();
            if (data.reminders && data.reminders.length > 0) {
                for (const reminder of data.reminders) {
                    handleDueReminder(reminder);
                }
            }
            if (data.checkInDue && data.checkInDueAt) {
                const checkInKey = `${sessionId}_${data.checkInDueAt}`;
                if (!deliveredCheckInKeys.current.has(checkInKey)) {
                    deliveredCheckInKeys.current.add(checkInKey);
                    sessionStorage.setItem(
                        'ff_delivered_checkins',
                        JSON.stringify([...deliveredCheckInKeys.current])
                    );
                    await triggerCheckIn(data.checkInDueAt);
                }
            }
        } catch {
            // Silent — will retry on next poll
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId, sessionId, handleDueReminder]);

    // Supabase Realtime subscription — fires instantly when cron marks a reminder surfaced
    useEffect(() => {
        if (!userId || !sessionId || !isSupabaseMode) return;

        let channel;
        import('@supabase/supabase-js').then(({ createClient }) => {
            const client = createClient(supabaseUrl, supabaseKey);
            channel = client
                .channel(`reminders_${userId}`)
                .on(
                    'postgres_changes',
                    {
                        event: 'UPDATE',
                        schema: 'public',
                        table: 'memory_items',
                        filter: `user_id=eq.${userId}`,
                    },
                    (payload) => {
                        if (payload.new.surfaced_at && !payload.old.surfaced_at) {
                            handleDueReminder(payload.new);
                        }
                    }
                )
                .subscribe();
        });

        return () => { channel?.unsubscribe(); };
    }, [userId, sessionId, handleDueReminder]);

    // Fallback polling — catches missed reminders (demo mode + Realtime hiccups).
    // The immediate check on mount is handled inside init() AFTER the briefing completes,
    // so we only set up the recurring interval here.
    useEffect(() => {
        if (!userId || !sessionId) return;
        const interval = setInterval(checkProactiveMessages, 15000);
        return () => clearInterval(interval);
    }, [userId, sessionId, checkProactiveMessages]);

    // Hydrate delivered IDs from sessionStorage after mount (client-side only)
    useEffect(() => {
        const stored = sessionStorage.getItem('ff_delivered_reminders');
        if (stored) {
            try {
                const ids = JSON.parse(stored);
                deliveredReminderIds.current = new Set(ids);
            } catch {
                // Silent — malformed JSON, just start fresh
            }
        }

        const storedCheckIns = sessionStorage.getItem('ff_delivered_checkins');
        if (storedCheckIns) {
            try {
                const keys = JSON.parse(storedCheckIns);
                deliveredCheckInKeys.current = new Set(keys);
            } catch {
                // Silent — malformed JSON, just start fresh
            }
        }
    }, []);

    // Page Visibility — immediately check when user returns to a backgrounded tab
    // (browsers throttle setInterval in background tabs, so reminders can be missed)
    useEffect(() => {
        if (!userId || !sessionId) return;
        const onVisible = () => {
            if (document.visibilityState === 'visible') checkProactiveMessages();
        };
        document.addEventListener('visibilitychange', onVisible);
        return () => document.removeEventListener('visibilitychange', onVisible);
    }, [userId, sessionId, checkProactiveMessages]);

    // Web Push — register service worker and subscribe after session is ready
    useEffect(() => {
        if (!userId || !sessionId || !isSupabaseMode) return;
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
        const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
        if (!vapidKey) return;

        async function setupPush() {
            try {
                const reg = await navigator.serviceWorker.register('/sw.js');
                const permission = await Notification.requestPermission();
                if (permission !== 'granted') return;

                // Reuse existing subscription if already subscribed on this device
                let sub = await reg.pushManager.getSubscription();
                if (!sub) {
                    sub = await reg.pushManager.subscribe({
                        userVisibleOnly: true,
                        applicationServerKey: urlBase64ToUint8Array(vapidKey),
                    });
                }
                await fetch('/api/push/subscribe', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId, subscription: sub.toJSON() }),
                });
            } catch {
                // Silent — push is opt-in enhancement, not critical
            }
        }

        setupPush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId, sessionId]);

    // Fire-and-forget: save a proactive message to conversation history
    function saveProactiveMessage(content) {
        fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: '__PROACTIVE__',
                sessionId,
                userId,
                userName,
                mode: 'proactive_save',
                content,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            }),
        }).catch(() => {});
    }
    // Stream a check-in message from the API
    async function triggerCheckIn() {
        if (isLoadingRef.current) return;
        setIsLoading(true);
        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: '__CHECK_IN__',
                    sessionId,
                    userId,
                    userName,
                    mode: 'check_in',
                    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                }),
            });

            if (!res.ok) throw new Error('Check-in API error');

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let fullText = '';

            setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') continue;
                        try {
                            const parsed = JSON.parse(data);
                            if (parsed.token) {
                                fullText += parsed.token;
                                setMessages((prev) => {
                                    const updated = [...prev];
                                    updated[updated.length - 1] = { role: 'assistant', content: fullText };
                                    return updated;
                                });
                            }
                        } catch {
                            // Skip malformed
                        }
                    }
                }
            }

            if (fullText) {
                saveProactiveMessage(fullText);
            }
        } catch {
            const fallbackText = "Hey! It's been about 25 minutes. How's it going? No pressure — want to **keep going**, **take a break**, or **try something different**?";
            setMessages((prev) => [
                ...prev,
                {
                    role: 'assistant',
                    content: fallbackText,
                },
            ]);
            saveProactiveMessage(fallbackText);
        } finally {
            setIsLoading(false);
        }
    }

    // ────────────────────────────────────────────
    //  Send initial system greeting (briefing or onboarding)
    // ────────────────────────────────────────────
    async function sendSystemMessage(sid, name, briefingDelivered, modeOverride = null) {
        setIsLoading(true);
        try {
            // Briefing triggers on first visit of each day (any time), not just mornings
            const mode = modeOverride || (!briefingDelivered ? 'briefing' : 'onboarding');

            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: mode === 'briefing' ? '__MORNING_BRIEFING__' : '__ONBOARDING__',
                    sessionId: sid,
                    userId: userId,
                    userName: name,
                    mode,
                    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                }),
            });

            if (!res.ok) throw new Error('Chat API error');

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let fullText = '';

            // Add empty assistant message
            setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') continue;
                        try {
                            const parsed = JSON.parse(data);
                            if (parsed.token) {
                                fullText += parsed.token;
                                setMessages((prev) => {
                                    const updated = [...prev];
                                    updated[updated.length - 1] = {
                                        role: 'assistant',
                                        content: fullText,
                                    };
                                    return updated;
                                });
                            }
                        } catch {
                            // Skip malformed JSON
                        }
                    }
                }
            }
        } catch {
            setMessages((prev) => [
                ...prev,
                {
                    role: 'assistant',
                    content:
                        "👋 Hey there! I'm FocusFlow — your ADHD-friendly companion. I'm here to help you start tasks, remember things, and stay on track. No pressure, no judgment. **What's on your mind today?**",
                },
            ]);
        } finally {
            setIsLoading(false);
        }
    }

    // Schedule a precise client-side check when the user sets a short reminder.
    // This fires checkProactiveMessages() at the exact due time instead of waiting
    // for the next 15s poll — critical for reminders < 5 minutes.
    function scheduleLocalReminderCheck(userText) {
        const stripped = userText
            .replace(/remind me (to |about )?/i, '')
            .replace(/remember (this|that)?:?\s*/i, '')
            .trim();
        const { remindAt } = parseRemindTime(stripped);
        if (!remindAt) return;
        const msUntil = new Date(remindAt) - Date.now();
        // Only schedule for reminders within the next 30 minutes
        if (msUntil > 0 && msUntil <= 30 * 60 * 1000) {
            setTimeout(() => checkProactiveMessages(), msUntil + 2000); // +2s buffer for DB write
        }
    }

    // ────────────────────────────────────────────
    //  Send user message
    // ────────────────────────────────────────────
    async function handleSend() {
        const text = input.trim();
        if (!text || isLoading) return;

        // If the message looks like a reminder, schedule a precise local check
        if (/remind me|remember this|note this/i.test(text)) {
            scheduleLocalReminderCheck(text);
        }

        setInput('');
        const userMsg = { role: 'user', content: text };
        setMessages((prev) => [...prev, userMsg]);
        setIsLoading(true);

        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: text,
                    sessionId: sessionId,
                    userId: userId,
                    userName: userName,
                    mode: 'chat',
                    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                    clientHistory: [...messages, userMsg].slice(-20).map((m) => ({ role: m.role, content: m.content })),
                }),
            });

            if (!res.ok) throw new Error('Chat API error');

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let fullText = '';

            // Add empty assistant message for streaming
            setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') continue;
                        try {
                            const parsed = JSON.parse(data);
                            if (parsed.token) {
                                fullText += parsed.token;
                                setMessages((prev) => {
                                    const updated = [...prev];
                                    updated[updated.length - 1] = {
                                        role: 'assistant',
                                        content: fullText,
                                    };
                                    return updated;
                                });
                            }
                        } catch {
                            // Skip malformed
                        }
                    }
                }
            }
            // After onboarding answers, sync the user name from the server
            if (userName === 'Friend') {
                try {
                    const sessRes = await fetch(`/api/session?userId=${userId}`);
                    const sessData = await sessRes.json();
                    if (sessData.display_name && sessData.display_name !== 'Friend') {
                        setUserName(sessData.display_name);
                        localStorage.setItem('focusflow_user_name', sessData.display_name);
                    }
                } catch { /* silent */ }
            }
        } catch {
            setMessages((prev) => [
                ...prev,
                {
                    role: 'assistant',
                    content:
                        "Hmm, something went sideways. That's okay — want to try sending that again? 🔄",
                },
            ]);
        } finally {
            setIsLoading(false);
        }
    }

    function handleKeyDown(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    }

    return (
        <div className="chat-container">
            {/* Header */}
            <header className="chat-header">
                <div className="chat-header-left">
                    <span className="chat-header-logo">🧠</span>
                    <div>
                        <h1>FocusFlow</h1>
                        <div className="chat-header-status">
                            <span className="status-dot" />
                            Online
                        </div>
                    </div>
                </div>
                {!process.env.NEXT_PUBLIC_SUPABASE_URL && <span className="demo-badge">Demo</span>}
            </header>

            {/* Messages */}
            <div className="messages-area">
                {messages.map((msg, i) => (
                    <div key={i} className={`message ${msg.role}`}>
                        {msg.role === 'assistant' ? (
                            <ReactMarkdown>{msg.content}</ReactMarkdown>
                        ) : (
                            <p>{msg.content}</p>
                        )}
                    </div>
                ))}

                {isLoading && messages[messages.length - 1]?.role !== 'assistant' && (
                    <div className="typing-indicator">
                        <div className="typing-dots">
                            <span />
                            <span />
                            <span />
                        </div>
                        Thinking...
                    </div>
                )}

                <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="input-area">
                <div className="input-wrapper">
                    <textarea
                        ref={textareaRef}
                        rows={1}
                        placeholder="What's on your mind?"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        disabled={isLoading}
                    />
                    <button
                        className="send-btn"
                        onClick={handleSend}
                        disabled={!input.trim() || isLoading}
                        aria-label="Send message"
                    >
                        ↑
                    </button>
                </div>
            </div>

            {/* Footer */}
            <div style={{ textAlign: 'center', padding: '8px', opacity: 0.5, fontSize: '0.75rem' }}>
                <a href="/privacy" style={{ color: '#7c83ff', textDecoration: 'none' }}>Privacy Policy</a>
            </div>
        </div>
    );
}
