// POST /api/telegram — Telegram webhook endpoint
// Telegram sends updates here instead of the bot polling for them.

import { createBot } from '@/lib/telegram/bot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const token = process.env.TELEGRAM_BOT_TOKEN;

let bot = null;
let initPromise = null;

async function getBot() {
    if (!bot && token) {
        bot = createBot(token);
        initPromise = bot.init();
    }
    if (initPromise) await initPromise;
    return bot;
}

export async function POST(request) {
    if (!token) {
        return Response.json({ error: 'TELEGRAM_BOT_TOKEN not set' }, { status: 500 });
    }

    // Optional: verify the request comes from Telegram via secret token
    const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (secretToken) {
        const headerSecret = request.headers.get('x-telegram-bot-api-secret-token');
        if (headerSecret !== secretToken) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }
    }

    try {
        const update = await request.json();
        const b = await getBot();
        await b.handleUpdate(update);
    } catch (err) {
        console.error('[Telegram Webhook] Error:', err.message);
    }

    // Always return 200 to Telegram to prevent retries
    return Response.json({ ok: true });
}

// GET endpoint for health checks
export async function GET() {
    return Response.json({
        ok: true,
        webhook: 'active',
        hasToken: !!token,
    });
}
