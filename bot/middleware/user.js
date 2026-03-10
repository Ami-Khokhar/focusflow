import { getUserByTelegramId, createUser, getOrCreateSession, getUser } from '../../lib/db.js';

/**
 * Middleware: resolves every Telegram update to a Flowy user + today's session.
 * Attaches ctx.flowyUser, ctx.flowySession, ctx.flowySessionId.
 */
export async function userMiddleware(ctx, next) {
    if (!ctx.from) return next();

    const telegramId = ctx.from.id;

    try {
        let user = await getUserByTelegramId(telegramId);

        if (!user) {
            const displayName = ctx.from.first_name || 'Friend';
            user = await createUser(displayName, null, telegramId);
        }

        const session = await getOrCreateSession(user.id);

        // Re-fetch user to get latest profile (onboarding may have updated it)
        const freshUser = await getUser(user.id);

        ctx.flowyUser = freshUser || user;
        ctx.flowySession = session;
        ctx.flowySessionId = session.id;
    } catch (err) {
        console.error('[Middleware] User resolution failed:', err.message);
    }

    return next();
}
