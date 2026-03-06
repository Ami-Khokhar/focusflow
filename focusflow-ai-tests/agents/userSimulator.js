/**
 * userSimulator.js — Generates realistic ADHD user conversation turns via Groq.
 */

import Groq from 'groq-sdk';
import { buildSimulatorPrompt, buildRandomConversationPrompt } from '../prompts/simulatorPrompt.js';

function getGroqClient() {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('GROQ_API_KEY not set in environment.');
    return new Groq({ apiKey });
}

/**
 * Generate one realistic user message for a given scenario and conversation history.
 *
 * @param {object} scenario    - The scenario descriptor from scenarios.js
 * @param {Array}  history     - Previous transcript turns [{role, content}]
 * @returns {Promise<string>}  - A single user message string
 */
export async function generateTurn(scenario, history = []) {
    const client = getGroqClient();

    const messages = [
        { role: 'system', content: buildSimulatorPrompt(scenario) },
        ...history.slice(-6), // keep last 3 exchanges for context
    ];

    // If this is the first turn, seed the conversation with a user marker
    if (history.length === 0) {
        messages.push({
            role: 'user',
            content: `Generate the opening message for this scenario. Remember: output ONLY the raw user message, nothing else.`,
        });
    } else {
        const lastAssistant = [...history].reverse().find((m) => m.role === 'assistant');
        messages.push({
            role: 'user',
            content: `The assistant just said: "${lastAssistant?.content || ''}". Generate the next user message continuing the scenario. Output ONLY the raw message.`,
        });
    }

    const response = await client.chat.completions.create({
        model: 'llama-3.1-8b-instant',
        messages,
        max_tokens: 80,
        temperature: 0.85,
    });

    return response.choices[0]?.message?.content?.trim() || scenario.seedMessage;
}

/**
 * Generate a fully randomized N-turn ADHD conversation (no scenario goal).
 * Useful for stress-testing FocusFlow with unpredictable inputs.
 *
 * @param {object} opts
 * @param {number} opts.turns          - Number of conversation turns to simulate
 * @param {Function} opts.onTurn       - Callback(turn, message) for logging
 *
 * @returns {Promise<Array<string>>}   - Array of generated user messages
 */
export async function generateRandomConversation({ turns = 10, onTurn } = {}) {
    const client = getGroqClient();
    const messages = [];

    for (let i = 1; i <= turns; i++) {
        const systemPrompt = buildRandomConversationPrompt(i, turns);

        const response = await client.chat.completions.create({
            model: 'llama-3.1-8b-instant',
            messages: [
                { role: 'system', content: systemPrompt },
                ...messages.slice(-4),
                { role: 'user', content: `Generate turn ${i}. Output ONLY the raw user message.` },
            ],
            max_tokens: 80,
            temperature: 0.9,
        });

        const userMsg = response.choices[0]?.message?.content?.trim() || 'ok so i forgot what i was doing';
        messages.push({ role: 'user', content: userMsg });

        if (onTurn) await onTurn(i, userMsg);

        // Small delay to stay within rate limits
        await new Promise((r) => setTimeout(r, 200));
    }

    return messages.filter((m) => m.role === 'user').map((m) => m.content);
}
