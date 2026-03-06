/**
 * reportGenerator.js — Builds test reports in terminal + Markdown format.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = path.resolve(__dirname, '../reports');

/**
 * Initialize a fresh report object.
 */
export function createReport(runLabel = '') {
    return {
        label: runLabel || `Run ${new Date().toISOString()}`,
        startTime: new Date().toISOString(),
        endTime: null,
        durationMs: 0,
        scenarios: [],
        passCount: 0,
        failCount: 0,
        errorCount: 0,
    };
}

/**
 * Append a scenario result to the report.
 *
 * @param {object} report
 * @param {object} result - Single scenario result
 * @param {string} result.name
 * @param {'PASS'|'FAIL'|'ERROR'} result.status
 * @param {string} result.reason
 * @param {string} [result.suggestedFix]
 * @param {object|null} [result.bug]
 * @param {Array} [result.transcript]
 * @param {number} [result.durationMs]
 */
export function addResult(report, result) {
    report.scenarios.push(result);
    if (result.status === 'PASS') report.passCount++;
    else if (result.status === 'FAIL') report.failCount++;
    else report.errorCount++;
}

/**
 * Finalize the report (set endTime and duration).
 */
export function finalizeReport(report) {
    report.endTime = new Date().toISOString();
    report.durationMs = new Date(report.endTime) - new Date(report.startTime);
    return report;
}

/**
 * Print a live scenario result to the console using chalk.
 */
export async function printResult(result) {
    const { default: chalk } = await import('chalk');

    const icon =
        result.status === 'PASS' ? chalk.green('✓') :
            result.status === 'FAIL' ? chalk.red('✗') :
                chalk.yellow('⚠');

    const statusColor =
        result.status === 'PASS' ? chalk.green(result.status) :
            result.status === 'FAIL' ? chalk.red(result.status) :
                chalk.yellow(result.status);

    console.log(`  ${icon} ${chalk.bold(result.name.padEnd(28))} ${statusColor}`);

    if (result.reason) {
        console.log(`      ${chalk.dim('→')} ${chalk.dim(result.reason)}`);
    }

    if (result.status === 'FAIL' && result.suggestedFix) {
        console.log(`      ${chalk.cyan('💡')} ${chalk.cyan(result.suggestedFix)}`);
    }

    if (result.bug?.bugFound) {
        console.log(`      ${chalk.magenta('🐛 Bug:')} ${chalk.magenta(result.bug.description)}`);
        if (result.bug.suggestedFix) {
            console.log(`      ${chalk.magenta('   Fix:')} ${chalk.magenta(result.bug.suggestedFix)}`);
        }
    }
}

/**
 * Print a summary table to the console.
 */
export async function printSummary(report) {
    const { default: chalk } = await import('chalk');
    const total = report.scenarios.length;

    console.log('\n' + chalk.bold('━'.repeat(55)));
    console.log(chalk.bold('  FocusFlow AI Test Report'));
    console.log(chalk.bold('━'.repeat(55)));
    console.log(`  Total:  ${total}`);
    console.log(`  ${chalk.green('Pass:')}   ${report.passCount}`);
    console.log(`  ${chalk.red('Fail:')}   ${report.failCount}`);
    if (report.errorCount > 0) {
        console.log(`  ${chalk.yellow('Error:')}  ${report.errorCount}`);
    }
    console.log(`  Duration: ${(report.durationMs / 1000).toFixed(1)}s`);
    console.log(chalk.bold('━'.repeat(55)));

    if (report.failCount === 0 && report.errorCount === 0) {
        console.log(chalk.green.bold('\n  ✅ All tests passed!\n'));
    } else {
        console.log(chalk.red.bold(`\n  ❌ ${report.failCount + report.errorCount} test(s) failed.\n`));
    }
}

/**
 * Write a Markdown report file and return its path.
 */
export function writeMarkdownReport(report) {
    if (!fs.existsSync(REPORTS_DIR)) {
        fs.mkdirSync(REPORTS_DIR, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filePath = path.join(REPORTS_DIR, `test-report-${timestamp}.md`);

    const lines = [
        `# FocusFlow AI Test Report`,
        ``,
        `**Run:** ${report.label}`,
        `**Date:** ${new Date(report.startTime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`,
        `**Duration:** ${(report.durationMs / 1000).toFixed(1)}s`,
        ``,
        `## Summary`,
        ``,
        `| Metric | Count |`,
        `|--------|-------|`,
        `| ✅ Pass | ${report.passCount} |`,
        `| ❌ Fail | ${report.failCount} |`,
        `| ⚠️ Error | ${report.errorCount} |`,
        `| Total | ${report.scenarios.length} |`,
        ``,
        `## Scenario Results`,
        ``,
    ];

    for (const r of report.scenarios) {
        const emoji = r.status === 'PASS' ? '✅' : r.status === 'FAIL' ? '❌' : '⚠️';
        lines.push(`### ${emoji} ${r.name}`);
        lines.push(`**Status:** ${r.status}`);
        if (r.durationMs) lines.push(`**Duration:** ${(r.durationMs / 1000).toFixed(1)}s`);
        lines.push(`**Evaluation:** ${r.reason}`);

        if (r.status === 'FAIL' && r.suggestedFix) {
            lines.push(`**Suggested Fix:** ${r.suggestedFix}`);
        }

        if (r.bug?.bugFound) {
            lines.push(`\n**🐛 Bug Detected**`);
            lines.push(`- ${r.bug.description}`);
            if (r.bug.reproSteps) lines.push(`- **Repro:** ${r.bug.reproSteps}`);
            if (r.bug.suggestedFix) lines.push(`- **Fix:** ${r.bug.suggestedFix}`);
        }

        if (r.transcript && r.transcript.length > 0) {
            lines.push(`\n<details>`);
            lines.push(`<summary>Conversation Transcript</summary>`);
            lines.push(``);
            lines.push('```');
            for (const turn of r.transcript) {
                lines.push(`[${turn.role.toUpperCase()}] ${turn.content}`);
                lines.push('');
            }
            lines.push('```');
            lines.push(`</details>`);
        }

        lines.push('');
    }

    lines.push('---');
    lines.push(`*Generated by FocusFlow AI Testing System*`);

    fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
    return filePath;
}

/**
 * Write a JSON report (for CI artifact ingestion).
 */
export function writeJsonReport(report) {
    if (!fs.existsSync(REPORTS_DIR)) {
        fs.mkdirSync(REPORTS_DIR, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filePath = path.join(REPORTS_DIR, `test-report-${timestamp}.json`);
    fs.writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf8');
    return filePath;
}

/**
 * Write full conversation transcripts to a log file.
 */
export function writeTranscriptLog(scenarios) {
    if (!fs.existsSync(REPORTS_DIR)) {
        fs.mkdirSync(REPORTS_DIR, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filePath = path.join(REPORTS_DIR, `transcripts-${timestamp}.txt`);

    const lines = [`FocusFlow AI Test Transcripts — ${new Date().toLocaleString()}`, ''];

    for (const r of scenarios) {
        if (!r.transcript) continue;
        lines.push(`${'='.repeat(60)}`);
        lines.push(`SCENARIO: ${r.name} [${r.status}]`);
        lines.push(`${'='.repeat(60)}`);
        for (const turn of r.transcript) {
            lines.push(`[${turn.role.toUpperCase()}]: ${turn.content}`);
            lines.push('');
        }
    }

    fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
    return filePath;
}
