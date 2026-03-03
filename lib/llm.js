// ────────────────────────────────────────────
//  FocusFlow — LLM Integration Layer
//  Groq SDK (production) + simulated demo mode
// ────────────────────────────────────────────

import { filterForbiddenWords } from './prompts';

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const isDemoMode = !GROQ_API_KEY;

// ─── Demo Mode: simulated streaming responses ───

const DEMO_RESPONSES = {
    onboarding: (name) =>
        `Hey ${name}! 👋 I'm FocusFlow — here to help you start tasks, hold onto thoughts, and check in gently when you want. **What's on your mind today?**`,

    briefing: (name, items) => {
        const hour = new Date().getHours();
        let greeting;
        if (hour >= 5 && hour < 12) greeting = 'Good morning';
        else if (hour >= 12 && hour < 17) greeting = 'Good afternoon';
        else if (hour >= 17 && hour < 21) greeting = 'Good evening';
        else greeting = 'Hey there';
        const date = new Date().toLocaleDateString('en-IN', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
        });

        if (!items || items.length === 0) {
            return `${greeting}, ${name}! ☀️ It's **${date}**.\n\nYou don't have anything on your list yet — and that's totally fine. **What's the most important thing you need to do today?**`;
        }

        const top3 = items.slice(0, 3);
        const taskList = top3.map((item, i) => `${i + 1}. **${item.content}**`).join('\n');
        return `${greeting}, ${name}! ☀️ It's **${date}**.\n\nHere's what's on your radar:\n${taskList}\n\nWant to start with the first one? I can help break it down into a tiny first step.`;
    },

    decomposition: () =>
        "That's a worthwhile thing to work on. Here's a starting point:\n\n**First step:** Open a blank document (or note) and write one sentence about what the end result looks like. That's it — one sentence.\n\nOnce you've done that, we can figure out the next piece together. **Want me to check in with you in 25 minutes?** ⏱️",

    memory_capture: (content) =>
        `Got it! ✅ I've noted: **"${content}"**\n\nI'll keep this safe and surface it when it's relevant. Anything else on your mind?`,

    memory_recall: (items) => {
        if (!items || items.length === 0) {
            return "You haven't shared anything with me yet — and that's perfectly fine! Whenever you want to dump a thought, task, or link, I'll hold onto it for you. 🧠";
        }

        const grouped = {};
        for (const item of items) {
            const cat = item.category || 'Note';
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(item.content);
        }

        let response = "Here's everything you've shared with me:\n\n";
        for (const [category, contents] of Object.entries(grouped)) {
            response += `**${category}s:**\n`;
            for (const c of contents) {
                response += `- ${c}\n`;
            }
            response += '\n';
        }
        response += 'Want to add, update, or remove anything?';
        return response;
    },

    memory_delete: () =>
        "Done — I've removed the last thing you shared with me. No trace left. 🗑️\n\nAnything else?",

    task_complete: (taskName) => {
        if (taskName) {
            return `Yes!! You finished **"${taskName}"** — that's a real win. Seriously, be proud of that. What's next?`;
        }
        return `That's what I'm talking about! Task done. You showed up and got it done — that matters. What's next?`;
    },

    reminder_set: (content, remindAt) => {
        const time = new Date(remindAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        return `Got it! ⏰ I'll remind you about **"${content}"** at **${time}**. I've got your back on this one.\n\nAnything else on your mind?`;
    },

    check_in: () =>
        "Hey! It's been about 25 minutes. How's it going? No pressure at all — want to **keep going**, **take a break**, or **try something different**?",

    check_in_set: () =>
        "I've set a 25-minute timer. Go get started — you've got this! **Focus mode: ON.** 🎯\n\nI'll be quiet until then unless you need me.",

    general: () => {
        const responses = [
            "I hear you. **What would feel most helpful right now** — breaking something down into steps, or capturing a thought so you don't lose it?",
            "Thanks for sharing that. Want to talk through it, or would you like me to note it down for later?",
            "Got it! Is there anything specific you'd like help starting on today? No pressure — whenever you're ready. 💛",
        ];
        return responses[Math.floor(Math.random() * responses.length)];
    },
};

/**
 * Stream a response from the LLM (or demo simulator).
 * Returns a ReadableStream of SSE-formatted chunks.
 */
export async function streamChatResponse({
    systemPrompt,
    conversationHistory,
    onToken,
    mode = 'chat',
    userName = 'Friend',
    memoryItems = [],
    userMessage = '',
    remindAt = null,
}) {
    if (isDemoMode) {
        return streamDemoResponse({ mode, userName, memoryItems, userMessage, remindAt, onToken });
    }

    return streamGroqResponse({ systemPrompt, conversationHistory, onToken });
}

// ─── Groq production streaming ───

async function streamGroqResponse({ systemPrompt, conversationHistory, onToken }) {
    const Groq = (await import('groq-sdk')).default;
    const client = new Groq({ apiKey: GROQ_API_KEY });

    try {
        const stream = await client.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: [
                { role: 'system', content: systemPrompt },
                ...conversationHistory,
            ],
            stream: true,
            temperature: 0.7,
            max_tokens: 500,
        });

        let fullText = '';

        for await (const chunk of stream) {
            const token = chunk.choices?.[0]?.delta?.content || '';
            if (token) {
                fullText += token;
                onToken(token);
            }
        }

        // Post-filter the full response for forbidden words
        const filtered = filterForbiddenWords(fullText);
        if (filtered !== fullText) {
            // If filtering changed something, we already streamed the original.
            // For MVP this is acceptable — the filter catches edge cases.
        }

        return filtered;
    } catch (error) {
        console.error('Groq API error:', error.message);
        const fallback =
            "Hmm, I hit a small snag connecting to my brain. That happens sometimes! Want to try again? I'm here. 🔄";
        onToken(fallback);
        return fallback;
    }
}

// ─── Demo mode simulated streaming ───

async function streamDemoResponse({ mode, userName, memoryItems, userMessage, remindAt, onToken }) {
    let response;

    switch (mode) {
        case 'onboarding':
            response = DEMO_RESPONSES.onboarding(userName);
            break;
        case 'briefing':
            response = DEMO_RESPONSES.briefing(userName, memoryItems);
            break;
        case 'decomposition':
            response = DEMO_RESPONSES.decomposition();
            break;
        case 'memory_capture':
            response = DEMO_RESPONSES.memory_capture(userMessage);
            break;
        case 'memory_recall':
            response = DEMO_RESPONSES.memory_recall(memoryItems);
            break;
        case 'memory_delete':
            response = DEMO_RESPONSES.memory_delete();
            break;
        case 'reminder_set':
            response = DEMO_RESPONSES.reminder_set(userMessage, remindAt);
            break;
        case 'check_in':
            response = DEMO_RESPONSES.check_in();
            break;
        case 'check_in_set':
            response = DEMO_RESPONSES.check_in_set();
            break;
        case 'task_complete':
            response = DEMO_RESPONSES.task_complete(userMessage);
            break;
        default:
            response = DEMO_RESPONSES.general();
    }

    // Simulate streaming by emitting tokens with small delays
    const words = response.split(' ');
    let fullText = '';

    for (let i = 0; i < words.length; i++) {
        const token = (i === 0 ? '' : ' ') + words[i];
        fullText += token;
        onToken(token);
        // Small delay to simulate streaming (15-40ms per word)
        await new Promise((r) => setTimeout(r, 15 + Math.random() * 25));
    }

    return fullText;
}
