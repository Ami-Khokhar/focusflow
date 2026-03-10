/**
 * behaviorEvaluator.js — Evaluates FocusFlow assistant responses for coaching quality.
 * Uses Groq LLM to detect tone, empathy, forbidden language, and intent correctness.
 */

import Groq from 'groq-sdk';
import { buildEvaluatorPrompt, buildEvaluatorUserMessage } from '../prompts/evaluatorPrompt.js';

import { getGroqClient } from '../utils/groqClient.js';

// ─── Forbidden word / phrase check (fast, no LLM needed) ────────────────────

const FORBIDDEN_PATTERNS = [
    /\blazy\b/i,
    /\beasy\b/i,
    /\boverdue\b/i,
    /\bshould have\b/i,
    /\byou failed\b/i,
    /\bjust do it\b/i,
    /\bsimple task\b/i,
    /\bobviously\b/i,
    /\bprocrastinat/i,   // procrastinating / procrastination (accusatory uses)
    /\byou need to\b/i,
];

function detectForbiddenLanguage(text) {
    for (const pattern of FORBIDDEN_PATTERNS) {
        const match = text.match(pattern);
        if (match) return match[0];
    }
    return null;
}

// ─── Main evaluator ───────────────────────────────────────────────────────────

/**
 * Evaluate an assistant response against FocusFlow's coaching standards.
 *
 * @param {string} userMessage
 * @param {string} assistantResponse
 * @param {object} scenario            - The scenario descriptor
 *
 * @returns {Promise<{ verdict: 'PASS'|'FAIL', qualityScore: number, reason: string, suggestedFix: string, dimensions: object, flags: string[] }>}
 */
export async function evaluate(userMessage, assistantResponse, scenario) {
    // Fast-path: forbidden language check (avoid unnecessary LLM call)
    const forbidden = detectForbiddenLanguage(assistantResponse);
    if (forbidden) {
        return {
            verdict: 'FAIL',
            qualityScore: 0,
            reason: `Response contains forbidden language: "${forbidden}"`,
            suggestedFix: `Remove "${forbidden}" from the response. Check \`lib/prompts.js\` for the filterForbiddenWords list and add this term.`,
            dimensions: { empathy: 0, brevity: 0, actionability: 0, safety: 0, naturalness: 0 },
            flags: [`Forbidden word detected: "${forbidden}"`],
        };
    }

    // Fast-path: empty response
    if (!assistantResponse || assistantResponse.trim().length < 5) {
        return {
            verdict: 'FAIL',
            qualityScore: 0,
            reason: 'Assistant returned an empty or nearly empty response.',
            suggestedFix: 'Check the streaming connection in apiClient.js and the /api/chat route error handling.',
            dimensions: { empathy: 0, brevity: 0, actionability: 0, safety: 0, naturalness: 0 },
            flags: ['Response was empty or too short.'],
        };
    }

    let attempts = 0;
    while (attempts < 3) {
        try {
            const client = getGroqClient();
            const response = await client.chat.completions.create({
                model: 'llama-3.1-8b-instant', // Downgraded to avoid 70B TPD limits
                messages: [
                    { role: 'system', content: buildEvaluatorPrompt() },
                    { role: 'user', content: buildEvaluatorUserMessage(scenario, userMessage, assistantResponse) },
                ],
                max_tokens: 400,
                temperature: 0.2, // low temperature for deterministic evaluation
                response_format: { type: 'json_object' },
            });

            const raw = response.choices[0]?.message?.content || '{}';
            const parsed = JSON.parse(raw);

            return {
                verdict: parsed.verdict === 'PASS' ? 'PASS' : 'FAIL',
                qualityScore: typeof parsed.qualityScore === 'number' ? parsed.qualityScore : 0,
                reason: parsed.reason || 'No reason provided.',
                suggestedFix: parsed.suggestedFix || '',
                dimensions: parsed.dimensions || { empathy: 0, brevity: 0, actionability: 0, safety: 0, naturalness: 0 },
                flags: Array.isArray(parsed.flags) ? parsed.flags : [],
            };
        } catch (err) {
            attempts++;
            if (attempts >= 3) {
                // If the LLM call fails completely, degrade gracefully with a heuristic result
                console.warn(`  [BehaviorEvaluator] LLM call failed after 3 tries: ${err.message}. Using heuristic fallback.`);
                return heuristicEvaluate(assistantResponse, scenario);
            }
            await new Promise(r => setTimeout(r, 500));
        }
    }
}

/**
 * Heuristic fallback evaluator — no LLM required.
 * Used when the Groq API is unavailable or rate-limited.
 */
function heuristicEvaluate(assistantResponse, scenario) {
    // Basic checks
    const hasContent = assistantResponse.trim().length > 20;
    const seemsEmpathetic =
        /got it|i hear you|totally|let's|you've got|nice|great|you showed|i'll hold|i've noted|i can help/i.test(
            assistantResponse
        );
    const mentionsAction = /step|try|start|open|write|send|call|finish|break/i.test(assistantResponse);
    const wordCount = assistantResponse.trim().split(/\s+/).length;
    const flags = [];

    if (wordCount > 100) flags.push(`Response was ${wordCount} words — slightly over limit.`);

    // Estimate dimension scores heuristically
    const empathy = seemsEmpathetic ? 7 : 3;
    const brevity = wordCount <= 100 ? 8 : wordCount <= 130 ? 6 : 4;
    const actionability = mentionsAction ? 7 : 4;
    const safety = 8; // no forbidden language (already checked above fast-path)
    const naturalness = hasContent ? 7 : 2;

    const qualityScore = parseFloat(
        (empathy * 0.25 + brevity * 0.20 + actionability * 0.20 + safety * 0.20 + naturalness * 0.15).toFixed(2)
    );
    const dimensions = { empathy, brevity, actionability, safety, naturalness };

    if (!hasContent)
        return {
            verdict: 'FAIL',
            qualityScore: 0,
            reason: 'Response too short.',
            suggestedFix: '',
            dimensions: { empathy: 0, brevity: 0, actionability: 0, safety: 0, naturalness: 0 },
            flags: ['Response was too short to evaluate.'],
        };
    if (!seemsEmpathetic)
        return {
            verdict: 'FAIL',
            qualityScore,
            reason: 'Response does not appear empathetic (heuristic check).',
            suggestedFix: 'Review system prompt in lib/prompts.js to strengthen empathetic tone.',
            dimensions,
            flags,
        };

    // For task/reminder scenarios, check acknowledgment keywords
    if (scenario.expectedIntent === 'memory_capture' || scenario.expectedIntent === 'reminder_set') {
        const acknowledged = /got it|noted|i.ve|i'll remind|remind you|i.ll keep/i.test(assistantResponse);
        if (!acknowledged) {
            return {
                verdict: 'FAIL',
                qualityScore,
                reason: 'Response does not appear to acknowledge the captured item.',
                suggestedFix: 'Check memory_capture handler in /api/chat route.',
                dimensions,
                flags,
            };
        }
    }

    return {
        verdict: qualityScore >= 6 ? 'PASS' : 'FAIL',
        qualityScore,
        reason: 'Response appears empathetic and task-relevant (heuristic check).',
        suggestedFix: '',
        dimensions,
        flags,
    };
}

/**
 * Evaluate whether the correct tool was called.
 *
 * @param {object} params
 * @param {string} params.expectedTool - The tool name expected by the scenario
 * @param {string|null} params.actualTool - The tool name that was actually called (null if none)
 * @param {boolean} params.toolCalled - Whether any tool was called at all
 *
 * @returns {{ match: boolean, expected: string, actual: string, note: string }}
 */
export function evaluateToolAccuracy({ expectedTool, actualTool, toolCalled }) {
    const actual = actualTool || (toolCalled ? 'unknown' : 'none');
    const match = !!expectedTool && expectedTool === actualTool;

    let note;
    if (!expectedTool) {
        note = toolCalled
            ? `No tool was expected but "${actual}" was called — possible hallucination.`
            : 'No tool expected and none called. Correct.';
    } else if (!toolCalled) {
        note = `Expected tool "${expectedTool}" to be called but no tool was invoked.`;
    } else if (match) {
        note = `Correct tool called: "${expectedTool}".`;
    } else {
        note = `Wrong tool called. Expected "${expectedTool}", got "${actual}".`;
    }

    return { match, expected: expectedTool || 'none', actual, note };
}
