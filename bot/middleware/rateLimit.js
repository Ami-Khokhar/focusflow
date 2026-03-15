const rateLimits = new Map();
const MAX_REQUESTS = 30;
const WINDOW_MS = 60_000;

/**
 * In-memory rate limiter: 30 requests per minute per Telegram user.
 * Registered BEFORE userMiddleware so rejected users never hit the DB.
 */
export async function rateLimitMiddleware(ctx, next) {
    if (!ctx.from) return next();

    const telegramId = ctx.from.id;
    const now = Date.now();

    let entry = rateLimits.get(telegramId);
    if (!entry || now - entry.windowStart > WINDOW_MS) {
        entry = { windowStart: now, count: 0 };
        rateLimits.set(telegramId, entry);
    }

    entry.count++;

    if (entry.count > MAX_REQUESTS) {
        return ctx.reply("You're sending messages too fast — take a breath and try again in a minute.");
    }

    return next();
}
