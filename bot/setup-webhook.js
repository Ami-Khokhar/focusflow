// Setup or remove Telegram webhook
// Usage:
//   node bot/setup-webhook.js set https://yourapp.vercel.app/api/telegram
//   node bot/setup-webhook.js delete
//   node bot/setup-webhook.js info

await import('./env.js');

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
    console.error('TELEGRAM_BOT_TOKEN is not set.');
    process.exit(1);
}

const secret = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const [, , action, url] = process.argv;
const API = `https://api.telegram.org/bot${token}`;

async function callTelegram(method, body = {}) {
    const res = await fetch(`${API}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    return res.json();
}

if (action === 'set') {
    if (!url) {
        console.error('Usage: node bot/setup-webhook.js set <url>');
        console.error('Example: node bot/setup-webhook.js set https://myapp.vercel.app/api/telegram');
        process.exit(1);
    }

    const params = {
        url,
        allowed_updates: ['message', 'callback_query'],
        drop_pending_updates: true,
    };
    if (secret) params.secret_token = secret;

    const result = await callTelegram('setWebhook', params);
    console.log('Webhook set:', result);

} else if (action === 'delete') {
    const result = await callTelegram('deleteWebhook', { drop_pending_updates: true });
    console.log('Webhook deleted:', result);
    console.log('You can now use long polling: npm run bot:dev');

} else if (action === 'info') {
    const result = await callTelegram('getWebhookInfo');
    console.log('Webhook info:', JSON.stringify(result, null, 2));

} else {
    console.log(`Telegram Webhook Setup

Commands:
  node bot/setup-webhook.js set <url>    Set webhook URL
  node bot/setup-webhook.js delete       Remove webhook (for local dev)
  node bot/setup-webhook.js info         Show current webhook status

Examples:
  node bot/setup-webhook.js set https://myapp.vercel.app/api/telegram
  node bot/setup-webhook.js delete

Note: Long polling (npm run bot:dev) won't work while a webhook is set.
      Run 'delete' first to switch back to local development.`);
}
