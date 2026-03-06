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
import { getScenarioUseCases } from './useCases.js';
import { generateFuzzVariants } from './useCaseMutator.js';
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
    seedMessage as seedDbMessage
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
const IS_MATRIX = args.includes('--matrix') || args.includes('--flex');
const IS_FUZZ = args.includes('--fuzz') || args.includes('--flex');
const SHOULD_SHUFFLE = args.includes('--shuffle');
const SINGLE_SCENARIO = args.find((a) => a.startsWith('--scenario='))?.split('=')[1] ||
    (args.includes('--scenario') ? args[args.indexOf('--scenario') + 1] : null);
const MAX_VARIANTS = (() => {
    const direct = args.find((a) => a.startsWith('--max-variants='));
    const val = direct ? direct.split('=')[1] : (args.includes('--max-variants') ? args[args.indexOf('--max-variants') + 1] : null);
    const n = val ? parseInt(val, 10) : null;
    return Number.isFinite(n) && n > 0 ? n : null;
})();
const FUZZ_PER_CASE = (() => {
    const direct = args.find((a) => a.startsWith('--fuzz-per-case='));
    const val = direct ? direct.split('=')[1] : (args.includes('--fuzz-per-case') ? args[args.indexOf('--fuzz-per-case') + 1] : null);
    const n = val ? parseInt(val, 10) : null;
    return Number.isFinite(n) && n > 0 ? n : 3;
})();
const REPEAT_EACH = (() => {
    const direct = args.find((a) => a.startsWith('--repeat='));
    const val = direct ? direct.split('=')[1] : (args.includes('--repeat') ? args[args.indexOf('--repeat') + 1] : null);
    const n = val ? parseInt(val, 10) : null;
    return Number.isFinite(n) && n > 0 ? n : 1;
})();
const MAX_RUNS = (() => {
    const direct = args.find((a) => a.startsWith('--max-runs='));
    const val = direct ? direct.split('=')[1] : (args.includes('--max-runs') ? args[args.indexOf('--max-runs') + 1] : null);
    const n = val ? parseInt(val, 10) : null;
    return Number.isFinite(n) && n > 0 ? n : null;
})();
const SEED = (() => {
    const direct = args.find((a) => a.startsWith('--seed='));
    const val = direct ? direct.split('=')[1] : (args.includes('--seed') ? args[args.indexOf('--seed') + 1] : null);
    const n = val ? parseInt(val, 10) : null;
    return Number.isFinite(n) ? n : 7;
})();

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function preflight() {
    const { default: chalk } = await import('chalk');
    console.log(chalk.bold('\n🧠 FocusFlow AI Test Suite\n'));
    console.log(`   API:      ${BASE_URL}`);
    console.log(`   Supabase: ${process.env.SUPABASE_URL || '(demo mode)'}`);
    const deterministicModeLabel = (() => {
        if (IS_MATRIX || IS_FUZZ) {
            const chunks = [];
            if (IS_MATRIX) chunks.push('use-case matrix');
            if (IS_FUZZ) chunks.push(`fuzz (${FUZZ_PER_CASE}/case)`);
            if (MAX_VARIANTS) chunks.push(`max variants ${MAX_VARIANTS}`);
            if (REPEAT_EACH > 1) chunks.push(`repeat x${REPEAT_EACH}`);
            if (SHOULD_SHUFFLE) chunks.push(`shuffle seed ${SEED}`);
            if (MAX_RUNS) chunks.push(`max runs ${MAX_RUNS}`);
            return chunks.join(', ');
        }
        if (SINGLE_SCENARIO) return `Single: ${SINGLE_SCENARIO}`;
        return 'Full suite (8 scenarios)';
    })();
    console.log(`   Mode:     ${IS_RANDOM ? 'Randomized' : IS_LONG ? 'Long (20 turns)' : deterministicModeLabel}`);

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

function makeRng(seed = 1) {
    let state = seed >>> 0;
    return () => {
        state = (1664525 * state + 1013904223) >>> 0;
        return state / 0xffffffff;
    };
}

function shuffleInPlace(items, seed = 1) {
    const rng = makeRng(seed);
    for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
    }
}

function buildScenarioRuns(scenario, {
    matrix = false,
    fuzz = false,
    fuzzPerCase = 3,
    maxVariants = null,
    repeatEach = 1,
    seed = 7,
} = {}) {
    const baseCandidates = matrix
        ? (getScenarioUseCases(scenario.id).length > 0
            ? getScenarioUseCases(scenario.id)
            : [{ id: 'baseline', message: scenario.seedMessage }])
        : [{ id: 'baseline', message: scenario.seedMessage }];

    const deduped = [];
    const seen = new Set();
    for (const c of baseCandidates) {
        const key = (c.message || '').trim().toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        deduped.push(c);
    }

    const expanded = [];
    for (const c of deduped) {
        const id = c.id || 'baseline';
        const message = c.message || scenario.seedMessage;
        expanded.push({ id, message });

        if (fuzz) {
            const fuzzed = generateFuzzVariants(message, {
                seed: seed + id.length + message.length,
                maxVariants: fuzzPerCase,
            });
            for (const f of fuzzed) {
                expanded.push({ id: `${id}_${f.id}`, message: f.message });
            }
        }
    }

    const finalDeduped = [];
    const finalSeen = new Set();
    for (const c of expanded) {
        const key = (c.message || '').trim().toLowerCase();
        if (!key || finalSeen.has(key)) continue;
        finalSeen.add(key);
        finalDeduped.push(c);
    }

    const limited = maxVariants ? finalDeduped.slice(0, maxVariants) : finalDeduped;
    const runs = [];
    for (let i = 0; i < limited.length; i++) {
        const c = limited[i];
        for (let attempt = 1; attempt <= repeatEach; attempt++) {
            const suffix = repeatEach > 1 ? ` #${attempt}` : '';
            runs.push({
                runName: `${scenario.name} [${c.id || `case_${i + 1}`}]${suffix}`,
                seedMessage: c.message,
                useCaseId: c.id || `case_${i + 1}`,
            });
        }
    }

    return runs;
}

// ─── Run a single deterministic scenario ─────────────────────────────────────

async function captureStateWithRetry({ isDemo, userId, sessionId, retries = 1, delayMs = 200 }) {
    if (isDemo) return {};

    let lastSnapshot = null;
    let lastError = null;

    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            lastSnapshot = {
                items: await getMemoryItems(userId),
                allItems: await getAllMemoryItems(userId),
                session: await getSessionById(sessionId),
            };
            if (attempt < retries - 1) {
                await new Promise((r) => setTimeout(r, delayMs));
            }
        } catch (err) {
            lastError = err;
            if (attempt < retries - 1) {
                await new Promise((r) => setTimeout(r, delayMs));
            }
        }
    }

    if (!lastSnapshot && lastError) throw lastError;
    return lastSnapshot || {};
}

async function runScenario({ scenario, userId, sessionId, seedMessage = null, runName = null, useCaseId = null }) {
    const { default: chalk } = await import('chalk');
    const startTime = Date.now();

    console.log(chalk.bold(`\n  -> ${runName || scenario.name}`));

    const transcript = [];
    const scenarioSeedMessage = seedMessage || scenario.seedMessage;
    const userTurns = Array.isArray(scenario.multiTurnMessages) && scenario.multiTurnMessages.length > 0
        ? scenario.multiTurnMessages
        : [scenarioSeedMessage];

    try {
        const isDemo = !process.env.SUPABASE_URL;

        // 1. Setup preconditions (seed DB)
        const dbOptions = {
            getMemoryItems, getAllMemoryItems, getLatestReminder, getSessionById, seedMemoryItem, seedMessage: seedDbMessage, createTestSession
        };
        const seedData = isDemo ? null : await scenario.setup(dbOptions, userId);
        const effectiveSessionId = seedData?.seededSessionId || sessionId;

        // 2. Snapshot DB state BEFORE
        const before = await captureStateWithRetry({
            isDemo,
            userId,
            sessionId: effectiveSessionId,
            retries: 1,
            delayMs: 0,
        });

        // 3. Drive the scenario conversation (single-turn by default, multi-turn when configured)
        const clientHistory = [];
        const turnSnapshots = [];
        const shouldCaptureTurnSnapshots = !isDemo && (scenario.captureTurnSnapshots || userTurns.length > 1);
        let finalUserMessage = scenarioSeedMessage;
        let finalAssistantResponse = '';

        for (let idx = 0; idx < userTurns.length; idx++) {
            const turnMessage = userTurns[idx];
            const { fullResponse } = await sendMessage({
                baseUrl: BASE_URL,
                message: turnMessage,
                sessionId: effectiveSessionId,
                userId,
                timezone: TIMEZONE,
                clientHistory: [...clientHistory],
            });

            transcript.push({ role: 'user', content: turnMessage });
            transcript.push({ role: 'assistant', content: fullResponse });
            clientHistory.push({ role: 'user', content: turnMessage });
            clientHistory.push({ role: 'assistant', content: fullResponse });

            finalUserMessage = turnMessage;
            finalAssistantResponse = fullResponse;

            const turnLabel = userTurns.length > 1 ? `[turn ${idx + 1}] ` : '';
            console.log(chalk.dim(`     [user]      ${turnLabel}${turnMessage}`));
            console.log(chalk.dim(`     [assistant] ${fullResponse.slice(0, 120)}${fullResponse.length > 120 ? '...' : ''}`));

            if (shouldCaptureTurnSnapshots) {
                const turnState = await captureStateWithRetry({
                    isDemo,
                    userId,
                    sessionId: effectiveSessionId,
                    retries: 2,
                    delayMs: 150,
                });
                turnSnapshots.push({
                    turn: idx + 1,
                    message: turnMessage,
                    capturedAt: new Date().toISOString(),
                    items: turnState.items || [],
                    allItems: turnState.allItems || [],
                    session: turnState.session || null,
                });
            }
        }

        // 4. Snapshot DB state AFTER
        const after = await captureStateWithRetry({
            isDemo,
            userId,
            sessionId: effectiveSessionId,
            retries: 3,
            delayMs: 250,
        });

        // 5. Evaluate behavior (tone, coaching quality)
        const evaluation = scenario.disableBehaviorEval
            ? { verdict: 'PASS', reason: scenario.behaviorEvalReason || 'Behavior evaluator disabled for this scenario.', suggestedFix: '' }
            : await evaluate(finalUserMessage, finalAssistantResponse, scenario);

        // 6. Check DB for bugs
        const bugReport = isDemo ? null : await scenario.dbCheck(
            dbOptions,
            userId,
            effectiveSessionId,
            seedData,
            before,
            after,
            finalAssistantResponse,
            transcript,
            { turnSnapshots }
        );

        // 7. Determine final status
        const hasBug = bugReport?.bugFound === true;
        const evalFailed = evaluation.verdict === 'FAIL';
        const status = evalFailed || hasBug ? 'FAIL' : 'PASS';

        return {
            name: runName || scenario.name,
            useCaseId,
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
            name: runName || scenario.name,
            useCaseId,
            status: 'ERROR',
            reason: err.message,
            suggestedFix: 'Check the server logs and ensure /api/chat is reachable.',
            bug: null,
            transcript,
            durationMs: Date.now() - startTime,
        };
    }
}
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
    let allRuns = [];
    for (const scenario of scenariosToRun) {
        const scenarioRuns = buildScenarioRuns(scenario, {
            matrix: IS_MATRIX,
            fuzz: IS_FUZZ,
            fuzzPerCase: FUZZ_PER_CASE,
            maxVariants: MAX_VARIANTS,
            repeatEach: REPEAT_EACH,
            seed: SEED,
        }).map((run) => ({ ...run, scenario }));
        allRuns.push(...scenarioRuns);
    }

    if (SHOULD_SHUFFLE) {
        shuffleInPlace(allRuns, SEED);
    }
    if (MAX_RUNS) {
        allRuns = allRuns.slice(0, MAX_RUNS);
    }

    for (const run of allRuns) {
        const result = await runScenario({
            scenario: run.scenario,
            userId,
            sessionId,
            seedMessage: run.seedMessage,
            runName: run.runName,
            useCaseId: run.useCaseId,
        });
        addResult(report, result);
        await printResult(result);
        // Small delay between test cases to avoid rate limits
        await new Promise((r) => setTimeout(r, 500));
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






