/**
 * Reject messages over 5 000 characters before they reach any handler.
 */
export async function inputGuardMiddleware(ctx, next) {
    if (ctx.message?.text?.length > 5000) {
        return ctx.reply("Could you trim that down? I work best with shorter messages.");
    }
    return next();
}
