#!/usr/bin/env node
/**
 * runEvals.js — Flowy Eval System Orchestrator
 *
 * Usage:
 *   node focusflow-ai-tests/runEvals.js                    # run all scenarios
 *   node focusflow-ai-tests/runEvals.js --compare-baseline  # regression check
 *   node focusflow-ai-tests/runEvals.js --tier=critical     # critical only
 *   node focusflow-ai-tests/runEvals.js --scenario=<id>     # single scenario
 *   node focusflow-ai-tests/runEvals.js --save-baseline     # save current run as baseline
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Load .env (load ALL found env files — local first, then parent) ─────────
function loadEnvFile(p) {
    if (!existsSync(p)) return;
    const content = readFileSync(p, 'utf8');
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (key && !process.env[key]) process.env[key] = val;
    }
}
loadEnvFile(resolve(__dirname, '.env'));
loadEnvFile(resolve(__dirname, '../.env.local'));

// ─── Imports ─────────────────────────────────────────────────────────────────
import { scenarios as coreScenarios } from './tests/scenarios.js';
import { extendedScenarios } from './scenarios/extendedScenarios.js';
import { sendMessage } from './utils/apiClient.js';
import {
    createTestUser,
    createTestSession,
    cleanupTestUser,
    getMemoryItems,
    getAllMemoryItems,
    getSessionById,
    getLatestReminder,
    seedMemoryItem,
    seedMessage as seedDbMessage,
} from './utils/dbClient.js';
import { evaluate } from './agents/behaviorEvaluator.js';
import {
    createReport,
    addResult,
    finalizeReport,
    printResult,
    printSummary,
    writeMarkdownReport,
    writeJsonReport,
    writeTranscriptLog,
} from './utils/reportGenerator.js';
import { generateFailureReport } from './reporter.js';

// ─── Args ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const COMPARE_BASELINE = args.includes('--compare-baseline');
const SAVE_BASELINE = args.includes('--save-baseline');
const SINGLE_SCENARIO = args.find((a) => a.startsWith('--scenario='))?.split('=')[1] ||
    (args.includes('--scenario') ? args[args.indexOf('--scenario') + 1] : null);
const TIER_FILTER = (() => {
    const t = args.find((a) => a.startsWith('--tier='))?.split('=')[1];
    return t || null;
})();

const BASE_URL = process.env.FOCUSFLOW_URL || 'http://localhost:3000';
const TIMEZONE = 'Asia/Kolkata';
const BASELINE_PATH = resolve(__dirname, 'baseline.json');
const REPORTS_DIR = resolve(__dirname, 'reports');

// ─── Combine all scenarios ────────────────────────────────────────────────────
const allScenarios = [...coreScenarios, ...extendedScenarios];

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function preflight() {
    const { default: chalk } = await import('chalk');
    console.log(chalk.bold('\nFlowy Eval System\n'));
    console.log(`   API:      ${BASE_URL}`);
    console.log(`   Supabase: ${process.env.SUPABASE_URL || '(demo mode)'}`);
    console.log(`   Mode:     ${COMPARE_BASELINE ? 'Regression Check' : SAVE_BASELINE ? 'Save Baseline' : 'Full Eval Run'}`);
    if (TIER_FILTER) console.log(`   Tier:     ${TIER_FILTER}`);
    if (SINGLE_SCENARIO) console.log(`   Scenario: ${SINGLE_SCENARIO}`);

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
                res.resume();
            }).on('error', (e) => { clearTimeout(timeout); reject(e); });
        });
        console.log(chalk.green('   Server:   reachable\n'));
    } catch (err) {
        console.log(chalk.red(`   Server:   NOT reachable at ${BASE_URL}`));
        console.log(chalk.yellow('\n   Start the server with: npm run dev\n'));
        process.exit(1);
    }
}

function loadBaseline() {
    if (!existsSync(BASELINE_PATH)) return null;
    try {
        return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
    } catch {
        return null;
    }
}

function saveBaseline(report) {
    if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });
    const baseline = {
        runDate: new Date().toISOString().slice(0, 10),
        passRate: report.passCount / (report.scenarios.length || 1),
        avgQualityScore: (() => {
            const scored = report.scenarios.filter((s) => s.qualityScore != null);
            if (!scored.length) return null;
            return parseFloat((scored.reduce((s, r) => s + r.qualityScore, 0) / scored.length).toFixed(2));
        })(),
        scenarioResults: Object.fromEntries(
            report.scenarios.map((s) => [s.id || s.name, {
                status: s.status,
                qualityScore: s.qualityScore ?? null,
            }])
        ),
    };
    writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2), 'utf8');
    return baseline;
}

function checkRegressions(currentReport, baseline) {
    const regressions = [];
    for (const result of currentReport.scenarios) {
        const id = result.id || result.name;
        const prev = baseline.scenarioResults?.[id];
        if (!prev) continue;

        if (prev.status === 'PASS' && result.status === 'FAIL') {
            regressions.push({ id, type: 'regression', message: `Was PASS -> now FAIL` });
        }
        if (prev.qualityScore != null && result.qualityScore != null) {
            const drop = prev.qualityScore - result.qualityScore;
            if (drop > 1.5) {
                regressions.push({ id, type: 'quality_drop', message: `Quality dropped ${drop.toFixed(1)} points (${prev.qualityScore} -> ${result.qualityScore})` });
            }
        }
    }
    return regressions;
}

async function captureState(isDemo, userId, sessionId) {
    if (isDemo) return {};
    try {
        return {
            items: await getMemoryItems(userId),
            allItems: await getAllMemoryItems(userId),
            session: await getSessionById(sessionId),
        };
    } catch {
        return {};
    }
}

async function runScenario({ scenario, userId, sessionId }) {
    const { default: chalk } = await import('chalk');
    const startTime = Date.now();
    console.log(chalk.bold(`\n  -> ${scenario.name}`));

    const transcript = [];
    const userTurns = Array.isArray(scenario.multiTurnMessages) && scenario.multiTurnMessages.length > 0
        ? scenario.multiTurnMessages
        : [scenario.seedMessage];

    try {
        const isDemo = !process.env.SUPABASE_URL;
        const dbOptions = {
            getMemoryItems, getAllMemoryItems, getLatestReminder, getSessionById,
            seedMemoryItem, seedMessage: seedDbMessage, createTestSession,
        };

        const seedData = isDemo ? null : await scenario.setup(dbOptions, userId);
        const effectiveSessionId = seedData?.seededSessionId || sessionId;

        const before = await captureState(isDemo, userId, effectiveSessionId);

        const clientHistory = [];
        let finalUserMessage = userTurns[0];
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

            console.log(chalk.dim(`     [user]      ${turnMessage}`));
            console.log(chalk.dim(`     [assistant] ${fullResponse.slice(0, 120)}${fullResponse.length > 120 ? '...' : ''}`));

            if (idx < userTurns.length - 1) {
                await new Promise((r) => setTimeout(r, 8000));
            }
        }

        const after = await captureState(isDemo, userId, effectiveSessionId);

        // Behavior evaluation
        const evaluation = scenario.disableBehaviorEval
            ? { verdict: 'PASS', reason: scenario.behaviorEvalReason || 'Disabled.', suggestedFix: '', qualityScore: null, dimensions: null, flags: [] }
            : await evaluate(finalUserMessage, finalAssistantResponse, scenario);

        // Cooldown after evaluator Groq call
        await new Promise((r) => setTimeout(r, 5000));

        // DB bug check
        const bugReport = isDemo ? null : await scenario.dbCheck(
            dbOptions, userId, effectiveSessionId, seedData, before, after,
            finalAssistantResponse, transcript, {}
        );

        const hasBug = bugReport?.bugFound === true;
        const evalFailed = evaluation.verdict === 'FAIL';
        const status = evalFailed || hasBug ? 'FAIL' : 'PASS';

        return {
            id: scenario.id,
            name: scenario.name,
            tier: scenario.tier || 'standard',
            status,
            qualityScore: evaluation.qualityScore ?? null,
            dimensions: evaluation.dimensions ?? null,
            flags: evaluation.flags ?? [],
            reason: evaluation.reason,
            suggestedFix: evaluation.suggestedFix || '',
            bug: bugReport,
            transcript,
            durationMs: Date.now() - startTime,
        };
    } catch (err) {
        console.error(`  Error in ${scenario.name}:`, err.message);
        return {
            id: scenario.id,
            name: scenario.name,
            tier: scenario.tier || 'standard',
            status: 'ERROR',
            qualityScore: null,
            dimensions: null,
            flags: [],
            reason: err.message,
            suggestedFix: 'Check server logs.',
            bug: null,
            transcript,
            durationMs: Date.now() - startTime,
        };
    }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    const { default: chalk } = await import('chalk');
    await preflight();

    // Filter scenarios
    let scenariosToRun = allScenarios;
    if (SINGLE_SCENARIO) {
        scenariosToRun = allScenarios.filter((s) => s.id === SINGLE_SCENARIO);
        if (!scenariosToRun.length) {
            console.log(chalk.red(`  No scenario found with id "${SINGLE_SCENARIO}"`));
            console.log('  Available:', allScenarios.map((s) => s.id).join(', '));
            process.exit(1);
        }
    } else if (TIER_FILTER) {
        scenariosToRun = allScenarios.filter((s) => (s.tier || 'standard') === TIER_FILTER);
    }

    console.log(chalk.bold(`  Running ${scenariosToRun.length} scenario(s)...\n`));

    // Create test user/session
    if (process.env.SUPABASE_URL && !process.env.SUPABASE_SERVICE_KEY) {
        console.error(chalk.red('\nMissing SUPABASE_SERVICE_KEY in focusflow-ai-tests/.env\n'));
        process.exit(1);
    }

    let userId, sessionId;
    try {
        const user = await createTestUser('Eval Bot');
        const session = await createTestSession(user.id);
        userId = user.id;
        sessionId = session.id;
        console.log(chalk.dim(`  Test user: ${userId}`));
        console.log(chalk.dim(`  Session:   ${sessionId}\n`));
    } catch (err) {
        console.log(chalk.yellow(`  DEMO MODE (no Supabase). DB checks skipped.\n`));
        userId = '00000000-0000-0000-0000-000000000001';
        sessionId = '00000000-0000-0000-0000-000000000001';
    }

    const report = createReport('Flowy Eval Suite');

    for (const scenario of scenariosToRun) {
        const result = await runScenario({ scenario, userId, sessionId });
        addResult(report, result);
        await printResult(result);
        await new Promise((r) => setTimeout(r, 10000));
    }

    try { await cleanupTestUser(userId); } catch { /* demo */ }

    finalizeReport(report);
    await printSummary(report);

    // Write reports
    if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });
    const mdPath = writeMarkdownReport(report);
    const jsonPath = writeJsonReport(report);
    writeTranscriptLog(report.scenarios);

    console.log(`  Report: ${mdPath}`);
    console.log(`  JSON:   ${jsonPath}`);

    // Generate failure report
    if (report.failCount > 0 || report.errorCount > 0) {
        const failReport = await generateFailureReport(report);
        console.log(`\n${failReport}`);
    }

    // Regression check
    if (COMPARE_BASELINE) {
        const baseline = loadBaseline();
        if (!baseline) {
            console.log(chalk.yellow('\n  No baseline.json found. Run with --save-baseline first.\n'));
        } else {
            const regressions = checkRegressions(report, baseline);
            if (regressions.length === 0) {
                console.log(chalk.green('\n  No regressions vs baseline.\n'));
            } else {
                console.log(chalk.red(`\n  ${regressions.length} regression(s) detected:\n`));
                for (const r of regressions) {
                    console.log(chalk.red(`     [${r.id}] ${r.message}`));
                }
                process.exit(1);
            }
        }
    }

    // Save baseline
    if (SAVE_BASELINE && report.failCount === 0 && report.errorCount === 0) {
        const baseline = saveBaseline(report);
        console.log(chalk.green(`\n  Baseline saved: ${BASELINE_PATH}`));
        console.log(chalk.dim(`     Pass rate: ${(baseline.passRate * 100).toFixed(0)}% | Avg quality: ${baseline.avgQualityScore ?? 'N/A'}\n`));
    } else if (SAVE_BASELINE && (report.failCount > 0 || report.errorCount > 0)) {
        console.log(chalk.yellow('\n  Baseline NOT saved — there are failures. Fix them first.\n'));
    }

    console.log('');
    process.exit(report.failCount + report.errorCount > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error('\nFatal error:', err);
    process.exit(1);
});
