/**
 * reporter.js — Failure grouping and triage output for the Flowy Eval System.
 * Groups failures by root cause category and maps them to file:line hints.
 */

// Maps root cause patterns to file/function hints
const ROOT_CAUSE_MAP = [
    {
        pattern: /SAVE_TRIGGERS|hallucinated save|phantom tool/i,
        category: 'tool',
        file: 'lib/langchain/streaming.js',
        hint: 'SAVE_TRIGGERS / DELETE_TRIGGERS regex (lines ~23-24)',
    },
    {
        pattern: /remind_at.*off|parseTime|2-hour|tomorrow|hours parsing/i,
        category: 'timing',
        file: 'lib/langchain/tools.js',
        hint: 'parseTime() / remind_at calculation',
    },
    {
        pattern: /reschedule|parseTimeOffset|push.*back/i,
        category: 'timing',
        file: 'lib/langchain/tools.js',
        hint: 'parseTimeOffset() / reschedule logic',
    },
    {
        pattern: /dedup|duplicate|80%|overlap/i,
        category: 'db',
        file: 'lib/db.js',
        hint: 'saveMemoryItem() dedup logic (overlap >= 0.8)',
    },
    {
        pattern: /deleteLastMemoryItem|delete.*empty|nothing to remove/i,
        category: 'db',
        file: 'lib/db.js',
        hint: 'deleteLastMemoryItem() / deleteMemoryItemByContent()',
    },
    {
        pattern: /check_in_due_at|set_checkin_timer|15.min|25.min/i,
        category: 'db',
        file: 'lib/langchain/tools.js',
        hint: 'set_checkin_timer tool / updateSession() call',
    },
    {
        pattern: /forbidden language|forbidden word|lazy|overdue|should have/i,
        category: 'prompt',
        file: 'lib/langchain/prompts.js',
        hint: 'FORBIDDEN_WORDS list / filterForbiddenWords()',
    },
    {
        pattern: /empath|tone|naturalness|coaching|robotic/i,
        category: 'prompt',
        file: 'lib/langchain/prompts.js',
        hint: 'System prompt — persona/tone section',
    },
    {
        pattern: /onboarding/i,
        category: 'prompt',
        file: 'lib/langchain/prompts.js',
        hint: 'Onboarding mode system prompt',
    },
    {
        pattern: /memory_recall|recall.*omit|recall.*missing/i,
        category: 'prompt',
        file: 'lib/langchain/prompts.js',
        hint: 'Memory recall system prompt / memory context injection',
    },
    {
        pattern: /status.*Done|markMemoryItemDone|task.*complete/i,
        category: 'db',
        file: 'lib/db.js',
        hint: 'markMemoryItemDone() / findMemoryItemByContent()',
    },
];

const CATEGORY_LABELS = {
    tool: 'Tool Guardrail',
    timing: 'Time Parsing',
    db: 'Database',
    prompt: 'System Prompt',
    unknown: 'Unknown',
};

function categorizeFailing(result) {
    const searchText = [
        result.reason || '',
        result.suggestedFix || '',
        result.bug?.description || '',
        result.bug?.suggestedFix || '',
    ].join(' ');

    for (const rule of ROOT_CAUSE_MAP) {
        if (rule.pattern.test(searchText)) {
            return {
                category: rule.category,
                file: rule.file,
                hint: rule.hint,
            };
        }
    }

    return { category: 'unknown', file: 'unknown', hint: 'Manual investigation needed.' };
}

/**
 * Generate a triage summary for all failing scenarios.
 *
 * @param {object} report - The finalized eval report
 * @returns {Promise<string>} Formatted triage output string
 */
export async function generateFailureReport(report) {
    const { default: chalk } = await import('chalk');

    const failures = report.scenarios.filter((s) => s.status === 'FAIL' || s.status === 'ERROR');

    if (failures.length === 0) {
        return chalk.green('  All failures triaged — none found.');
    }

    // Group by root cause category
    const groups = {};
    for (const result of failures) {
        const { category, file, hint } = categorizeFailing(result);
        const key = `${category}::${file}::${hint}`;
        if (!groups[key]) {
            groups[key] = { category, file, hint, results: [] };
        }
        groups[key].results.push(result);
    }

    const lines = [];
    lines.push(chalk.bold('\n  Failure Triage Report'));
    lines.push(chalk.bold('  ' + '-'.repeat(52)));
    lines.push('');

    for (const group of Object.values(groups)) {
        const label = CATEGORY_LABELS[group.category] || CATEGORY_LABELS.unknown;
        lines.push(chalk.bold(`  ${label} — ${group.results.length} failure(s)`));
        lines.push(chalk.dim(`  File:  ${group.file}`));
        lines.push(chalk.dim(`  Hint:  ${group.hint}`));
        lines.push('');

        for (const result of group.results) {
            const icon = result.status === 'ERROR' ? chalk.yellow('!') : chalk.red('x');
            lines.push(`    ${icon} ${chalk.bold(result.name)}`);
            if (result.reason) lines.push(`       Reason: ${result.reason}`);
            if (result.suggestedFix) lines.push(`       Fix:    ${chalk.cyan(result.suggestedFix)}`);
            if (result.bug?.description && result.bug.description !== result.reason) {
                lines.push(`       Bug:    ${chalk.magenta(result.bug.description)}`);
            }
            if (result.qualityScore != null) {
                const scoreColor = result.qualityScore >= 6 ? chalk.green : chalk.red;
                lines.push(`       Score:  ${scoreColor(result.qualityScore.toFixed(1))}/10`);
            }
            lines.push('');
        }

        // Group-level fix recommendation
        const fixCounts = {};
        for (const r of group.results) {
            const fix = r.suggestedFix || r.bug?.suggestedFix || '';
            if (fix) fixCounts[fix] = (fixCounts[fix] || 0) + 1;
        }
        const topFix = Object.entries(fixCounts).sort((a, b) => b[1] - a[1])[0];
        if (topFix) {
            lines.push(chalk.cyan(`  Top recommendation: ${topFix[0]}`));
            lines.push('');
        }
        lines.push('  ' + '-'.repeat(52));
        lines.push('');
    }

    lines.push(chalk.bold(`  Summary: ${Object.keys(groups).length} root cause group(s) across ${failures.length} failure(s)`));
    lines.push('');

    return lines.join('\n');
}

/**
 * Export a machine-readable failure summary for CI/dashboard use.
 */
export function getFailureSummary(report) {
    const failures = report.scenarios.filter((s) => s.status === 'FAIL' || s.status === 'ERROR');
    const groups = {};

    for (const result of failures) {
        const { category, file, hint } = categorizeFailing(result);
        const key = category;
        if (!groups[key]) groups[key] = { category, file, hint, count: 0, scenarios: [] };
        groups[key].count++;
        groups[key].scenarios.push({ id: result.id || result.name, reason: result.reason });
    }

    return {
        totalFailures: failures.length,
        groups: Object.values(groups),
        regressionRisk: failures.filter((f) => (f.tier || 'standard') === 'critical').length,
    };
}
