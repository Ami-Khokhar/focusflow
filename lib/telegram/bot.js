// ────────────────────────────────────────────
//  Shared Telegram Bot instance (thin wrapper)
//  All logic lives in bot/ — this just wires middleware + handlers.
// ────────────────────────────────────────────

import { Bot } from 'grammy';
import { rateLimitMiddleware } from '../../bot/middleware/rateLimit.js';
import { inputGuardMiddleware } from '../../bot/middleware/inputGuard.js';
import { userMiddleware } from '../../bot/middleware/user.js';
import { registerCommands } from '../../bot/commands.js';
import { handleCallback } from '../../bot/handlers/callbacks.js';
import { handleMessage } from '../../bot/handlers/chat.js';

/**
 * Create and configure a grammY Bot instance with all handlers.
 * Does NOT call bot.start() — caller decides polling vs webhook.
 */
export function createBot(token) {
    const bot = new Bot(token);

    // Middleware — order matters: reject fast before DB calls
    bot.use(rateLimitMiddleware);
    bot.use(inputGuardMiddleware);
    bot.use(userMiddleware);

    // Commands
    registerCommands(bot);

    // Callbacks (reminder keep/dismiss/done buttons)
    bot.on('callback_query:data', handleCallback);

    // Free-text messages
    bot.on('message:text', handleMessage);

    // Global error handler
    bot.catch((err) => console.error('[Bot] Error:', err.message || err));

    return bot;
}
