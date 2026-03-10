/**
 * groqClient.js — Groq SDK client factory for the eval test suite.
 * Replaces the deleted lib/groqClient.js.
 */

import Groq from 'groq-sdk';

let _client = null;

export function getGroqClient() {
    if (_client) return _client;
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
        throw new Error('GROQ_API_KEY not set. Add it to focusflow-ai-tests/.env');
    }
    _client = new Groq({ apiKey });
    return _client;
}
