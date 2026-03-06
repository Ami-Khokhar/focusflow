/**
 * apiClient.js — HTTP client for FocusFlow's /api/chat SSE endpoint.
 * Sends a message and collects the complete streamed response.
 */

import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

/**
 * Send a message to /api/chat and collect the full response.
 *
 * @param {object} opts
 * @param {string} opts.baseUrl       - e.g. "http://localhost:3000"
 * @param {string} opts.message       - user message text
 * @param {string} opts.sessionId     - current session UUID
 * @param {string} opts.userId        - user UUID
 * @param {string} [opts.userName]    - display name
 * @param {string} [opts.timezone]    - IANA timezone
 * @param {string} [opts.mode]        - force a mode (e.g. "onboarding")
 * @param {Array}  [opts.clientHistory] - fallback history for demo mode
 * @param {number} [opts.timeoutMs]   - request timeout in ms (default 30000)
 *
 * @returns {Promise<{ fullResponse: string, durationMs: number }>}
 */
export async function sendMessage({
    baseUrl,
    message,
    sessionId,
    userId,
    userName = 'Friend',
    timezone = 'Asia/Kolkata',
    mode,
    clientHistory = [],
    timeoutMs = 30000,
}) {
    const start = Date.now();
    const url = new URL('/api/chat', baseUrl);

    const body = JSON.stringify({
        message,
        sessionId,
        userId,
        userName,
        timezone,
        ...(mode ? { mode } : {}),
        clientHistory,
    });

    const fullResponse = await new Promise((resolve, reject) => {
        const lib = url.protocol === 'https:' ? https : http;
        const timeout = setTimeout(() => reject(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);

        const req = lib.request(
            {
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: url.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body),
                    Accept: 'text/event-stream',
                },
            },
            (res) => {
                if (res.statusCode !== 200) {
                    clearTimeout(timeout);
                    let errBody = '';
                    res.on('data', (chunk) => (errBody += chunk));
                    res.on('end', () =>
                        reject(new Error(`HTTP ${res.statusCode}: ${errBody.slice(0, 200)}`))
                    );
                    return;
                }

                let buffer = '';
                let assembled = '';

                res.on('data', (chunk) => {
                    buffer += chunk.toString();
                    const lines = buffer.split('\n');
                    buffer = lines.pop(); // keep the incomplete last line

                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed.startsWith('data:')) continue;
                        const payload = trimmed.slice(5).trim();
                        if (payload === '[DONE]') continue;
                        try {
                            const parsed = JSON.parse(payload);
                            if (parsed.token) assembled += parsed.token;
                        } catch {
                            // ignore malformed SSE
                        }
                    }
                });

                res.on('end', () => {
                    clearTimeout(timeout);
                    resolve(assembled);
                });

                res.on('error', (err) => {
                    clearTimeout(timeout);
                    reject(err);
                });
            }
        );

        req.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
        });

        req.write(body);
        req.end();
    });

    return { fullResponse, durationMs: Date.now() - start };
}

/**
 * Run a multi-turn conversation and return the full transcript.
 *
 * @param {object} opts
 * @param {string} opts.baseUrl
 * @param {string} opts.sessionId
 * @param {string} opts.userId
 * @param {string} opts.timezone
 * @param {Array<string>} opts.messages  - ordered user messages
 * @param {number} [opts.delayMs]        - delay between turns (default 500ms)
 *
 * @returns {Promise<Array<{ role: string, content: string }>>}
 */
export async function runConversation({
    baseUrl,
    sessionId,
    userId,
    timezone = 'Asia/Kolkata',
    messages,
    delayMs = 500,
}) {
    const transcript = [];
    const clientHistory = []; // keep rolling for demo-mode fallback

    for (const message of messages) {
        transcript.push({ role: 'user', content: message });

        const { fullResponse } = await sendMessage({
            baseUrl,
            message,
            sessionId,
            userId,
            timezone,
            clientHistory: [...clientHistory],
        });

        transcript.push({ role: 'assistant', content: fullResponse });
        clientHistory.push({ role: 'user', content: message });
        clientHistory.push({ role: 'assistant', content: fullResponse });

        if (delayMs > 0) {
            await new Promise((r) => setTimeout(r, delayMs));
        }
    }

    return transcript;
}
