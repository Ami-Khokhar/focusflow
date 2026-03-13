// ────────────────────────────────────────────
//  FocusFlow — LangChain Agent Setup
//  ChatGroq with native tool calling (no AgentExecutor)
// ────────────────────────────────────────────

import { ChatGroq } from '@langchain/groq';
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import { FlowyResponseSchema } from './schema.js';

const isDemoMode = !process.env.GROQ_API_KEY && !process.env.GROQ_API_KEY_1 && !process.env.GROQ_API_KEY_2;

/**
 * Pick a random Groq API key from available env vars.
 */
function getGroqApiKey() {
    const keys = [];
    if (process.env.GROQ_API_KEY) keys.push(process.env.GROQ_API_KEY);
    for (let i = 2; i <= 10; i++) {
        const key = process.env[`GROQ_API_KEY_${i}`];
        if (key?.trim()) keys.push(key.trim());
    }
    return keys.length > 0 ? keys[Math.floor(Math.random() * keys.length)] : '';
}

/**
 * Create a ChatGroq model with tools bound.
 */
export function createModel() {
    if (isDemoMode) return null;

    const llm = new ChatGroq({
        apiKey: getGroqApiKey(),
        model: 'llama-3.3-70b-versatile',
        temperature: 0.7,
        maxTokens: 500,
    });

    return llm.withStructuredOutput(FlowyResponseSchema);
}

/**
 * Create a faster ChatGroq model for Telegram (8b-instant, lower tokens).
 */
export function createTelegramModel() {
    if (isDemoMode) return null;

    const llm = new ChatGroq({
        apiKey: getGroqApiKey(),
        model: 'llama-3.1-8b-instant',
        temperature: 0.7,
        maxTokens: 300,
    });

    return llm.withStructuredOutput(FlowyResponseSchema);
}

/**
 * Convert DB message history to LangChain message objects.
 */
export function convertHistory(messages) {
    return messages
        .filter((m) => !(m.role === 'assistant' && /^Hey! You asked me to remind you:/.test(m.content)))
        .filter((m) => m.content && m.content.trim())
        .map((m) => {
            if (m.role === 'user') return new HumanMessage(m.content);
            if (m.role === 'assistant') return new AIMessage(m.content);
            return new HumanMessage(m.content);
        });
}

export { isDemoMode, SystemMessage, HumanMessage, AIMessage };
