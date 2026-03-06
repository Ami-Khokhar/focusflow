#!/usr/bin/env node
/**
 * runTests.js — FocusFlow AI Test Suite Orchestrator
 *
 * Usage:
 *   node tests/runTests.js              # run all 8 deterministic scenarios
 *   node tests/runTests.js --random     # run a randomized ADHD conversation
 *   node tests/runTests.js --long       # run a 20-turn randomized conversation
 *   node tests/runTests.js --scenario memory_capture  # run one scenario by id
 *
 * Environment variables (set in focusflow-ai-tests/.env):
 *   FOCUSFLOW_URL         - http://localhost:3000
 *   SUPABASE_URL          - your Supabase project URL
 *   SUPABASE_SERVICE_KEY  - service role key (bypasses RLS)
 *   GROQ_API_KEY          - Groq API key
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Load .env from the test suite folder ────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../.env');
if (existsSync(envPath)) {
    const envContent = readFileSync(envPath, 'utf8');
    for (const line of envContent.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const value = trimmed.slice(eqIdx + 1).trim();
        if (key && !process.env[key]) process.env[key] = value;
    }
} else {
    // Fall back to reading from the parent project's .env.local
    const parentEnv = resolve(__dirname, '../../.env.local');
    if (existsSync(parentEnv)) {
        const envContent = readFileSync(parentEnv, 'utf8');
        for (const line of envContent.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx === -1) continue;
            const key = trimmed.slice(0, eqIdx).trim();
            const value = trimmed.slice(eqIdx + 1).trim();
            if (key && !process.env[key]) process.env[key] = value;
        }
    }
}

// ─── Imports ─────────────────────────────────────────────────────────────────
import { scenarios } from './scenarios.js';
import { sendMessage } from '../utils/apiClient.js';
import {
    createTestUser,
    createTestSession,
    cleanupTestUser,
    getMemoryItems,
    getAllMemoryItems,
    getSessionById,
    getLatestReminder,
    seedMemoryItem,
    seedMessage
} from '../utils/dbClient.js';
import { evaluate } from '../agents/behaviorEvaluator.js';
import { generateRandomConversation } from '../agents/userSimulator.js';
import {
    createReport,
    addResult,
    finalizeReport,
    printResult,
    printSummary,
    writeMarkdownReport,
    writeJsonReport,
    writeTranscriptLog,
} from '../utils/reportGenerator.js';

// ─── Config ───────────────────────────────────────────────────────────────────
const BASE_URL = process.env.FOCUSFLOW_URL || 'http://localhost:3000';
const TIMEZONE = 'Asia/Kolkata';
const args = process.argv.slice(2);
const IS_RANDOM = args.includes('--random');
const IS_LONG = args.includes('--long');
const SINGLE_SCENARIO = args.find((a) => a.startsWith('--scenario='))?.split('=')[1] ||
    (args.includes('--scenario') ? args[args.indexOf('--scenario') + 1] : null);

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function preflight() {
    const { default: chalk } = await import('chalk');
    console.log(chalk.bold('\n🧠 FocusFlow AI Test Suite\n'));
    console.log(`   API:      ${BASE_URL}`);
    console.log(`   Supabase: ${process.env.SUPABASE_URL || '(demo mode)'}`);
    console.log(`   Mode:     ${IS_RANDOM ? 'Randomized' : IS_LONG ? 'Long (20 turns)' : SINGLE_SCENARIO ? `Single: ${SINGLE_SCENARIO}` : 'Full suite (8 scenarios)'}`);

    // Ping the server using the built-in /api/ping health check (GET, no auth needed)
    try {
        const pingUrl = new URL('/api/ping', BASE_URL);
        const lib = pingUrl.protocol === 'https:'
            ? (await import('node:https')).default
            : (await import('node:http')).default;

        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Ping timed out after 8s')), 8000);
            lib.get(pingUrl.toString(), (res) => {
                clearTimeout(timeout);
                if (res.statusCode === 200) resolve();
                else reject(new Error(`HTTP ${res.statusCode}`));
                res.resume(); // drain the response body
            }).on('error', (e) => { clearTimeout(timeout); reject(e); });
        });
        console.log(chalk.green('   Server:   ✓ reachable'));
    } catch (err) {
        console.log(chalk.red(`   Server:   ✗ NOT reachable at ${BASE_URL}`));
        console.log(chalk.red(`   Error:     ${err.message}`));
        console.log(chalk.yellow('\n   ▶ Start the server with: npm run dev\n'));
        process.exit(1);
    }
    console.log('');
}

// ─── Run a single deterministic scenario ─────────────────────────────────────

async function runScenario(scenario, userId, sessionId) {
    const { default: chalk } = await import('chalk');
    const startTime = Date.now();

    console.log(chalk.bold(`\n  ▶ ${scenario.name}`));

    const transcript = [];

    try {
        const isDemo = !process.env.SUPABASE_URL;

        // 1. Setup preconditions (seed DB)
        const dbOptions = {
            getMemoryItems, getAllMemoryItems, getLatestReminder, getSessionById, seedMemoryItem, seedMessage, createTestSession
        };
        const seedData = isDemo ? null : await scenario.setup(dbOptions, userId);
        const effectiveSessionId = seedData?.seededSessionId || sessionId;

        // 2. Snapshot DB state BEFORE
        const before = isDemo ? {} : {
            items: await getMemoryItems(userId),
            allItems: await getAllMemoryItems(userId),
            session: await getSessionById(effectiveSessionId),
        };

        // 3. Send the user message to FocusFlow
        const { fullResponse, durationMs } = await sendMessage({
            baseUrl: BASE_URL,
            message: scenario.seedMessage,
            sessionId: effectiveSessionId,
            userId,
            timezone: TIMEZONE,
        });

        transcript.push({ role: 'user', content: scenario.seedMessage });
        transcript.push({ role: 'assistant', content: fullResponse });

        console.log(chalk.dim(`     [user]      ${scenario.seedMessage}`));
        console.log(chalk.dim(`     [assistant] ${fullResponse.slice(0, 120)}${fullResponse.length > 120 ? '…' : ''}`));

        // 4. Snapshot DB state AFTER
        const after = isDemo ? {} : {
            items: await getMemoryItems(userId),
            allItems: await getAllMemoryItems(userId),
            session: await getSessionById(effectiveSessionId),
        };

        // 5. Evaluate behavior (tone, coaching quality)
        const evaluation = await evaluate(scenario.seedMessage, fullResponse, scenario);

        // 6. Check DB for bugs
        const bugReport = isDemo ? null : await scenario.dbCheck(
            dbOptions,
            userId,
            effectiveSessionId,
            seedData,
            before,
            after,
            fullResponse
        );

        // 7. Determine final status
        const hasBug = bugReport?.bugFound === true;
        const evalFailed = evaluation.verdict === 'FAIL';
        const status = evalFailed || hasBug ? 'FAIL' : 'PASS';

        return {
            name: scenario.name,
            status,
            reason: evaluation.reason,
            suggestedFix: evaluation.suggestedFix || '',
            bug: bugReport,
            transcript,
            durationMs: Date.now() - startTime,
        };
    } catch (err) {
        console.error(`  Error in ${scenario.name}:`, err.message);
        return {
            name: scenario.name,
            status: 'ERROR',
            reason: err.message,
            suggestedFix: 'Check the server logs and ensure /api/chat is reachable.',
            bug: null,
            transcript,
            durationMs: Date.now() - startTime,
        };
    }
}

// ─── Run randomized ADHD conversation ────────────────────────────────────────

async function runRandomConversation({ turns = 10, label = 'Randomized ADHD Conversation' }) {
    const { default: chalk } = await import('chalk');
    console.log(chalk.bold(`\n  ▶ ${label} (${turns} turns)`));

    const report = createReport(label);
    const transcript = [];

    // Create a fresh test user
    let userId, sessionId;
    if (process.env.SUPABASE_URL && !process.env.SUPABASE_SERVICE_KEY) {
        console.error('\n' + chalk.red('❌ Missing SUPABASE_SERVICE_KEY in focusflow-ai-tests/.env'));
        console.error(chalk.yellow('FocusFlow is connected to Supabase, so you MUST provide the Service Role key to create a true test user.'));
        console.error(chalk.dim('Please get the "service_role" secret from the Supabase Project API settings and add it to your local .env.\n'));
        process.exit(1);
    }

    try {
        const user = await createTestUser('ADHD Random Tester');
        const session = await createTestSession(user.id);
        userId = user.id;
        sessionId = session.id;
    } catch (err) {
        console.error(chalk.yellow(`\n  ⚠ Failed to create test user in Supabase: ${err.message}`));
        // True demo mode — use fixed IDs
        userId = '00000000-0000-0000-0000-000000000002';
        sessionId = '00000000-0000-0000-0000-000000000003';
    }

    const clientHistory = [];
    let failCount = 0;

    const userMessages = await generateRandomConversation({
        turns,
        onTurn: async (turn, msg) => {
            console.log(chalk.dim(`     [turn ${turn}] ${msg}`));
        },
    });

    for (const message of userMessages) {
        try {
            const { fullResponse } = await sendMessage({
                baseUrl: BASE_URL,
                message,
                sessionId,
                userId,
                timezone: TIMEZONE,
                clientHistory: [...clientHistory],
            });

            transcript.push({ role: 'user', content: message });
            transcript.push({ role: 'assistant', content: fullResponse });
            clientHistory.push({ role: 'user', content: message });
            clientHistory.push({ role: 'assistant', content: fullResponse });

            // Light evaluation for each turn
            const evaluation = await evaluate(message, fullResponse, {
                name: 'Random ADHD conversation',
                description: 'Randomized user message',
                expectedIntent: 'general',
                expectedBehavior: 'Empathetic, coaching tone. Brief. No forbidden words.',
            });

            if (evaluation.verdict === 'FAIL') failCount++;
        } catch (err) {
            transcript.push({ role: 'user', content: message });
            transcript.push({ role: 'assistant', content: `[ERROR: ${err.message}]` });
            failCount++;
        }
        await new Promise((r) => setTimeout(r, 300));
    }

    const status = failCount === 0 ? 'PASS' : 'FAIL';
    addResult(report, {
        name: label,
        status,
        reason: failCount === 0
            ? `All ${turns} turns evaluated as empathetic and on-brand.`
            : `${failCount} turn(s) failed evaluation.`,
        suggestedFix: failCount > 0 ? 'Review the transcript for tone issues.' : '',
        transcript,
        durationMs: 0,
    });

    try {
        await cleanupTestUser(userId);
    } catch { /* demo mode */ }

    finalizeReport(report);
    return report;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    const { default: chalk } = await import('chalk');

    await preflight();

    // ── Randomized / long conversation mode ──
    if (IS_RANDOM || IS_LONG) {
        const turns = IS_LONG ? 20 : 10;
        const label = IS_LONG ? 'Long ADHD Conversation (20 turns)' : 'Randomized ADHD Conversation';
        const report = await runRandomConversation({ turns, label });

        await printSummary(report);
        const mdPath = writeMarkdownReport(report);
        const jsonPath = writeJsonReport(report);
        writeTranscriptLog(report.scenarios);

        console.log(`  📄 Report: ${chalk.underline(mdPath)}`);
        console.log(`  📊 JSON:   ${chalk.underline(jsonPath)}\n`);
        process.exit(report.failCount + report.errorCount > 0 ? 1 : 0);
        return;
    }

    // ── Deterministic scenario suite ──
    const report = createReport('FocusFlow Deterministic Suite');

    // Filter to a single scenario if --scenario flag used
    const scenariosToRun = SINGLE_SCENARIO
        ? scenarios.filter((s) => s.id === SINGLE_SCENARIO)
        : scenarios;

    if (scenariosToRun.length === 0) {
        console.log(chalk.red(`  No scenario found with id "${SINGLE_SCENARIO}". Available ids:`));
        for (const s of scenarios) console.log(`    - ${s.id}`);
        process.exit(1);
    }

    console.log(chalk.bold('  Running scenarios...\n'));

    // Create a fresh test user per suite (not per scenario, to allow multi-turn scenarios)
    let userId, sessionId;

    if (process.env.SUPABASE_URL && !process.env.SUPABASE_SERVICE_KEY) {
        console.error('\n' + chalk.red('❌ Missing SUPABASE_SERVICE_KEY in focusflow-ai-tests/.env'));
        console.error(chalk.yellow('FocusFlow is connected to Supabase, so you MUST provide the Service Role key to create a true test user.'));
        console.error(chalk.dim('Please get the "service_role" secret from the Supabase Project API settings and add it to your local focusflow-ai-tests/.env.\n'));
        process.exit(1);
    }

    try {
        const user = await createTestUser('AI Test Bot');
        const session = await createTestSession(user.id);
        userId = user.id;
        sessionId = session.id;
        console.log(chalk.dim(`  Test user: ${userId}`));
        console.log(chalk.dim(`  Session:   ${sessionId}\n`));
    } catch (err) {
        console.error(chalk.yellow(`\n  ⚠ Failed to create test user in Supabase:`));
        console.error(chalk.yellow(`    ${err.message}\n`));
        // True demo mode: use fixed IDs (no Supabase)
        console.log(chalk.yellow('  ℹ Running in DEMO MODE (no Supabase URLs detected). DB checks will be skipped.\n'));
        userId = '00000000-0000-0000-0000-000000000001';
        sessionId = '00000000-0000-0000-0000-000000000001';
    }

    // Run each scenario, sharing the same user/session
    for (const scenario of scenariosToRun) {
        const result = await runScenario(scenario, userId, sessionId);
        addResult(report, result);
        await printResult(result);
        // Small delay between scenarios to avoid rate limits
        await new Promise((r) => setTimeout(r, 800));
    }

    // Cleanup test data
    try {
        await cleanupTestUser(userId);
    } catch { /* demo mode — ignore */ }

    // Finalize and output
    finalizeReport(report);
    await printSummary(report);

    const mdPath = writeMarkdownReport(report);
    const jsonPath = writeJsonReport(report);
    writeTranscriptLog(report.scenarios);

    console.log(`  📄 Report:     ${chalk.underline(mdPath)}`);
    console.log(`  📊 JSON:       ${chalk.underline(jsonPath)}\n`);

    // Exit with failure code if any test failed (CI support)
    process.exit(report.failCount + report.errorCount > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error('\nFatal error:', err);
    process.exit(1);
});
