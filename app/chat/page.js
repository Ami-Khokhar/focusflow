'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';

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

                // Load existing messages
                if (session.messages && session.messages.length > 0) {
                    setMessages(session.messages);
                }

                // If this is a fresh session with no messages, trigger initial greeting
                if (!session.messages || session.messages.length === 0) {
                    await sendSystemMessage(session.id, name, session.briefing_delivered);
                }
            } catch {
                // Fallback: still create a session even if API fails
                setSessionId('demo-session');
                await sendSystemMessage('demo-session', name, false);
            }
        }

        init();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId, router]);

    // ────────────────────────────────────────────
    //  Proactive message polling (reminders + check-ins)
    // ────────────────────────────────────────────
    useEffect(() => {
        if (!userId || !sessionId) return;

        const checkProactiveMessages = async () => {
            // Don't inject proactive messages while the LLM is streaming
            if (isLoadingRef.current) return;

            try {
                const res = await fetch(`/api/reminders?userId=${userId}`);
                const data = await res.json();

                // Inject due reminders
                if (data.reminders && data.reminders.length > 0) {
                    for (const reminder of data.reminders) {
                        const content = `**Reminder:** ${reminder.content}\n\n_(This was something you asked me to hold onto.)_`;
                        setMessages((prev) => [...prev, { role: 'assistant', content }]);
                        // Persist the reminder message to conversation history
                        saveProactiveMessage(content);
                    }
                }

                // Trigger check-in if due
                if (data.checkInDue) {
                    await triggerCheckIn();
                }
            } catch {
                // Silent failure — will retry on next poll
            }
        };

        // Check immediately on mount (catches missed reminders from closed tab)
        checkProactiveMessages();

        const interval = setInterval(checkProactiveMessages, 30000); // 30 seconds
        return () => clearInterval(interval);
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
        } catch {
            setMessages((prev) => [
                ...prev,
                {
                    role: 'assistant',
                    content:
                        "Hey! It's been about 25 minutes. How's it going? No pressure — want to **keep going**, **take a break**, or **try something different**?",
                },
            ]);
        } finally {
            setIsLoading(false);
        }
    }

    // ────────────────────────────────────────────
    //  Send initial system greeting (briefing or onboarding)
    // ────────────────────────────────────────────
    async function sendSystemMessage(sid, name, briefingDelivered) {
        setIsLoading(true);
        try {
            // Briefing triggers on first visit of each day (any time), not just mornings
            const mode = !briefingDelivered ? 'briefing' : 'onboarding';

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

    // ────────────────────────────────────────────
    //  Send user message
    // ────────────────────────────────────────────
    async function handleSend() {
        const text = input.trim();
        if (!text || isLoading) return;

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
                <span className="demo-badge">Demo</span>
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
        </div>
    );
}
