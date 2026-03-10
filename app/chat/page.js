'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';

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

    const [userId, setUserId] = useState(null);

    useEffect(() => {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

        if (!supabaseUrl || !supabaseKey) {
            // Demo mode: use localStorage UUID
            setUserId(localStorage.getItem('focusflow_user_id') || '00000000-0000-0000-0000-000000000001');
            return;
        }

        // Middleware already verified auth. Fetch user info from our API (reads httpOnly cookies server-side).
        fetch('/api/user/me').then(res => {
            if (!res.ok) {
                router.push('/');
                return;
            }
            return res.json();
        }).then(data => {
            if (!data) return;
            setUserId(data.id);
            if (data.display_name && data.display_name !== 'Friend') {
                setUserName(data.display_name);
                localStorage.setItem('focusflow_user_name', data.display_name);
            }
        }).catch(() => router.push('/'));
    }, [router]);

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
        if (userId === null) return; // Still loading auth — wait
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
    const handleReminderAction = useCallback(async (reminderId, action) => {
        // Immediately show loading state
        setMessages((prev) => prev.map((msg) =>
            msg.reminderId === reminderId ? { ...msg, reminderLoading: action } : msg
        ));
        try {
            const res = await fetch('/api/memory', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ id: reminderId, action, userId }),
            });
            if (!res.ok) throw new Error('PATCH failed');
            // Replace buttons with confirmation text
            const label = action === 'keep_as_note' ? 'Kept as note' : 'Dismissed';
            setMessages((prev) => prev.map((msg) => {
                if (msg.reminderId === reminderId) {
                    return { role: 'assistant', content: `${msg.baseContent}\n\n*${label}.*` };
                }
                return msg;
            }));
        } catch {
            // Revert loading state and show inline error
            setMessages((prev) => prev.map((msg) =>
                msg.reminderId === reminderId ? { ...msg, reminderLoading: null } : msg
            ));
        }
    }, [userId]);

    const handleDueReminder = useCallback((reminder) => {
        if (deliveredReminderIds.current.has(reminder.id)) return;
        deliveredReminderIds.current.add(reminder.id);
        // Persist so page refreshes don't re-fire the same reminder
        sessionStorage.setItem(
            'ff_delivered_reminders',
            JSON.stringify([...deliveredReminderIds.current])
        );
        const baseContent = `Hey! You asked me to remind you: **${reminder.content}**`;
        setMessages((prev) => [...prev, {
            role: 'assistant',
            content: baseContent,
            reminderId: reminder.id,
            baseContent,
        }]);
        saveProactiveMessage(baseContent);
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
        import('@supabase/ssr').then(({ createBrowserClient }) => {
            const client = createBrowserClient(supabaseUrl, supabaseKey);
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
        }).catch(() => { });
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

            setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

            const fullText = await readSSEStream(res, (accumulated) => {
                setMessages((prev) => {
                    const updated = [...prev];
                    updated[updated.length - 1] = { role: 'assistant', content: accumulated };
                    return updated;
                });
            });

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

            setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

            await readSSEStream(res, (accumulated) => {
                setMessages((prev) => {
                    const updated = [...prev];
                    updated[updated.length - 1] = { role: 'assistant', content: accumulated };
                    return updated;
                });
            });
        } catch {
            setMessages((prev) => [
                ...prev,
                {
                    role: 'assistant',
                    content:
                        "👋 Hey there! I'm Flowy — your ADHD-friendly companion. I'm here to help you start tasks, remember things, and stay on track. No pressure, no judgment. **What's on your mind today?**",
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
        // If message looks like a near-future reminder, schedule an extra poll in 5 minutes
        const hasTimeRef = /\b(\d+\s*(min|minute|hour|hr|second|sec)s?|in a (min|moment|sec)|at \d+)/i.test(userText);
        if (hasTimeRef) {
            setTimeout(() => checkProactiveMessages(), 5 * 60 * 1000);
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

            setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

            await readSSEStream(res, (accumulated) => {
                setMessages((prev) => {
                    const updated = [...prev];
                    updated[updated.length - 1] = { role: 'assistant', content: accumulated };
                    return updated;
                });
            });
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

    async function readSSEStream(res, onToken) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value);
            for (const line of chunk.split('\n')) {
                if (!line.startsWith('data: ')) continue;
                const data = line.slice(6);
                if (data === '[DONE]') continue;
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.token) {
                        fullText += parsed.token;
                        onToken(fullText);
                    }
                } catch { /* skip malformed */ }
            }
        }
        return fullText;
    }

    return (
        <div className="chat-container">
            {/* Sidebar */}
            <aside className="sidebar">
                <div className="sidebar-header">
                    <img src="/logo.png" alt="Flowy Logo" className="sidebar-logo-img" />
                    <span className="sidebar-title">Flowy</span>
                </div>

                <button
                    className="btn-new-session"
                    onClick={() => {
                        localStorage.removeItem('focusflow_session_id');
                        window.location.reload();
                    }}
                >
                    + New Horizon
                </button>

                <nav className="sidebar-nav">
                    <div className="nav-label">Past Sessions</div>
                    <div className="nav-item active">
                        <span className="nav-item-title">{messages[0]?.content?.slice(0, 30) || 'Today\'s Focus'}...</span>
                        <span className="nav-item-meta">Active Now</span>
                    </div>
                </nav>

                <div className="sidebar-footer">
                    <div className="user-avatar">
                        {userName.charAt(0)}
                    </div>
                    <div className="user-info">
                        <div className="user-name">{userName}</div>
                        <div className="user-status">Present</div>
                    </div>
                    <button
                        className="settings-btn"
                        title="Sign out"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: 0.5 }}
                        onClick={async () => {
                            const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
                            const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
                            if (supabaseUrl && supabaseKey) {
                                const { createBrowserClient } = await import('@supabase/ssr');
                                const client = createBrowserClient(supabaseUrl, supabaseKey);
                                await client.auth.signOut();
                            }
                            localStorage.clear();
                            router.push('/');
                        }}
                    >
                        ↪
                    </button>
                </div>
            </aside>

            {/* Main Content */}
            <main className="main-content">
                <header className="chat-header">
                    <div className="header-meta">Active Reflection</div>
                    <button
                        onClick={async () => {
                            if (!sessionId) return;
                            await fetch('/api/chat/clear', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ sessionId, userId }),
                            });
                            setMessages([]);
                        }}
                        style={{ position: 'absolute', top: '12px', right: '12px', background: 'none', border: 'none', cursor: 'pointer', opacity: 0.4, fontSize: '11px', color: 'inherit' }}
                        title="Clear chat history"
                    >
                        clear
                    </button>
                    <div className="header-time" suppressHydrationWarning>
                        {new Date().toLocaleDateString('en-US', { weekday: 'long' })}, {new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    </div>

                    <div className="header-status-msg">
                        {briefingDoneRef.current ? "The light is changing." : "Welcome back."}
                    </div>
                    <div className="header-status-sub">
                        {briefingDoneRef.current
                            ? `It is currently ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}. Take a moment to breathe and notice your progress.`
                            : "Let's gather your thoughts and find a peaceful rhythm for the day."}
                    </div>
                </header>

                <div className="messages-area">
                    {messages.map((msg, i) => (
                        <div key={i} className={`message ${msg.role}`}>
                            {msg.role === 'assistant' ? (
                                <>
                                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                                    {msg.reminderId && (
                                        <div className="reminder-actions">
                                            <button
                                                className={`reminder-btn reminder-btn-keep${msg.reminderLoading === 'keep_as_note' ? ' reminder-btn-loading' : ''}`}
                                                onClick={() => handleReminderAction(msg.reminderId, 'keep_as_note')}
                                                disabled={!!msg.reminderLoading}
                                            >
                                                {msg.reminderLoading === 'keep_as_note' ? 'Saving...' : 'Keep as note'}
                                            </button>
                                            <button
                                                className={`reminder-btn reminder-btn-dismiss${msg.reminderLoading === 'dismiss' ? ' reminder-btn-loading' : ''}`}
                                                onClick={() => handleReminderAction(msg.reminderId, 'dismiss')}
                                                disabled={!!msg.reminderLoading}
                                            >
                                                {msg.reminderLoading === 'dismiss' ? 'Dismissing...' : 'Dismiss'}
                                            </button>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <p>{msg.content}</p>
                            )}
                        </div>
                    ))}

                    {isLoading && messages[messages.length - 1]?.role !== 'assistant' && (
                        <div className="message assistant" style={{ opacity: 0.7 }}>
                            <div className="typing-dots">
                                <span />
                                <span />
                                <span />
                            </div>
                        </div>
                    )}

                    <div ref={messagesEndRef} />
                </div>

                <div className="input-area">
                    <div className="input-wrapper">
                        <textarea
                            ref={textareaRef}
                            rows={1}
                            placeholder="Share a thought..."
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
                    <div className="footer-hint">Write Slowly • Breathe Deeply</div>
                </div>
            </main>
        </div>
    );
}
