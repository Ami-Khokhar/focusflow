// ────────────────────────────────────────────
//  FocusFlow — Shared Groq API Key Management
// ────────────────────────────────────────────

export const isDemoMode = !process.env.GROQ_API_KEY && !process.env.GROQ_API_KEY_1 && !process.env.GROQ_API_KEY_2;

/**
 * Pick a random Groq API key from available env vars.
 * Shared across primary model and fallback paths.
 */
export function getGroqApiKey() {
    const keys = [];
    if (process.env.GROQ_API_KEY) keys.push(process.env.GROQ_API_KEY);
    for (let i = 2; i <= 10; i++) {
        const key = process.env[`GROQ_API_KEY_${i}`];
        if (key?.trim()) keys.push(key.trim());
    }
    return keys.length > 0 ? keys[Math.floor(Math.random() * keys.length)] : '';
}
