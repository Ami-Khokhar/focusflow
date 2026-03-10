// POST /api/telegram — Telegram webhook endpoint
// Telegram sends updates here instead of the bot polling for them.

import { createBot } from '@/lib/telegram/bot';
import { webhookCallback } from 'grammy';

export const runtime = 'nodejs';

const token = process.env.TELEGRAM_BOT_TOKEN;

let handler = null;

function getHandler() {
    if (!handler && token) {
        const bot = createBot(token);
        handler = webhookCallback(bot, 'std/http');
    }
    return handler;
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
        const cb = getHandler();
        return await cb(request);
    } catch (err) {
        console.error('[Telegram Webhook] Error:', err.message);
        // Always return 200 to Telegram to prevent retries
        return Response.json({ ok: true });
    }
}

// GET endpoint for health checks
export async function GET() {
    return Response.json({
        ok: true,
        webhook: 'active',
        hasToken: !!token,
    });
}
