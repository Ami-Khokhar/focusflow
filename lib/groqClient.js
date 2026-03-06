import Groq from 'groq-sdk';

/**
 * Returns a configured Groq client using a randomly selected API key
 * from available environment variables (GROQ_API_KEY, GROQ_API_KEY_2, etc.)
 * This helps distribute load and avoid 429 rate limit errors.
 */
export function getGroqClient(preferredKey = "") {
    // Honor an explicit key when provided by callers (e.g., classifier key separation).
    const explicit = (preferredKey || '').trim();
    if (explicit) {
        return new Groq({ apiKey: explicit });
    }

    // Collect all available keys into an array
    const keys = [];

    // Check base key
    if (process.env.GROQ_API_KEY) {
        keys.push(process.env.GROQ_API_KEY);
    }

    // Check numbered keys (GROQ_API_KEY_2, GROQ_API_KEY_3, etc.)
    // Support up to 10 keys for rotation
    for (let i = 2; i <= 10; i++) {
        const key = process.env[`GROQ_API_KEY_${i}`];
        if (key && key.trim()) {
            keys.push(key.trim());
        }
    }

    if (keys.length === 0) {
        // Fallback: If no keys found, return a client with no key (which will fail gracefully later or rely on demo mode logic if applicable)
        console.warn('⚠️ No GROQ_API_KEY found in environment variables.');
        return new Groq({ apiKey: '' });
    }

    // Select a random key
    const selectedKey = keys[Math.floor(Math.random() * keys.length)];

    return new Groq({ apiKey: selectedKey });
}
