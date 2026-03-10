// Step 1: Load .env.local BEFORE any lib/ modules are imported
await import('./env.js');

// Step 2: Import shared bot + cron
const { createBot } = await import('../lib/telegram/bot.js');
const { startCronJobs } = await import('./cron.js');

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
    console.error('TELEGRAM_BOT_TOKEN is not set. Get one from @BotFather.');
    process.exit(1);
}

const bot = createBot(token);

// Register command list with Telegram
await bot.api.setMyCommands([
    { command: 'start', description: 'Start Flowy' },
    { command: 'briefing', description: 'Daily briefing' },
    { command: 'memory', description: 'View saved items' },
    { command: 'help', description: 'Show help' },
    { command: 'clear', description: 'Clear chat history' },
    { command: 'timezone', description: 'Set your timezone' },
]);

// Start cron jobs for reminders + check-ins
startCronJobs(bot);

// Start long polling
bot.start({
    onStart: () => console.log('[Flowy Bot] Running — listening for messages...'),
});
