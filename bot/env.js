/**
 * Load .env.local into process.env before any other modules.
 * Must be imported FIRST (via --import or dynamic import) so that
 * lib/supabase.js and lib/langchain/agent.js see the env vars at load time.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env.local');

try {
    const envFile = readFileSync(envPath, 'utf-8');
    for (const line of envFile.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex === -1) continue;
        const key = trimmed.slice(0, eqIndex).trim();
        const value = trimmed.slice(eqIndex + 1).trim();
        if (!process.env[key]) process.env[key] = value;
    }
    console.log('[env] Loaded .env.local');
} catch {
    console.log('[env] No .env.local found — using system environment');
}
