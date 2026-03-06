/**
 * behaviorEvaluator.js — Evaluates FocusFlow assistant responses for coaching quality.
 * Uses Groq LLM to detect tone, empathy, forbidden language, and intent correctness.
 */

import Groq from 'groq-sdk';
import { buildEvaluatorPrompt, buildEvaluatorUserMessage } from '../prompts/evaluatorPrompt.js';

function getGroqClient() {
    // Prefer a second key to avoid rate-limit clashes with the simulator
    const apiKey = process.env.GROQ_API_KEY_2 || process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('GROQ_API_KEY not set in environment.');
    return new Groq({ apiKey });
}

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
 * @returns {Promise<{ verdict: 'PASS'|'FAIL', reason: string, suggestedFix: string }>}
 */
export async function evaluate(userMessage, assistantResponse, scenario) {
    // Fast-path: forbidden language check (avoid unnecessary LLM call)
    const forbidden = detectForbiddenLanguage(assistantResponse);
    if (forbidden) {
        return {
            verdict: 'FAIL',
            reason: `Response contains forbidden language: "${forbidden}"`,
            suggestedFix: `Remove "${forbidden}" from the response. Check \`lib/prompts.js\` for the filterForbiddenWords list and add this term.`,
        };
    }

    // Fast-path: empty response
    if (!assistantResponse || assistantResponse.trim().length < 5) {
        return {
            verdict: 'FAIL',
            reason: 'Assistant returned an empty or nearly empty response.',
            suggestedFix: 'Check the streaming connection in apiClient.js and the /api/chat route error handling.',
        };
    }

    // LLM evaluation for tone, coaching style, and intent
    const client = getGroqClient();

    const prompt = buildEvaluatorUserMessage(scenario, userMessage, assistantResponse);

    try {
        const response = await client.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: [
                { role: 'system', content: buildEvaluatorPrompt() },
                { role: 'user', content: prompt },
            ],
            max_tokens: 300,
            temperature: 0.2, // low temperature for deterministic evaluation
            response_format: { type: 'json_object' },
        });

        const raw = response.choices[0]?.message?.content || '{}';
        const parsed = JSON.parse(raw);

        return {
            verdict: parsed.verdict === 'PASS' ? 'PASS' : 'FAIL',
            reason: parsed.reason || 'No reason provided.',
            suggestedFix: parsed.suggestedFix || '',
        };
    } catch (err) {
        // If the LLM call fails, degrade gracefully with a heuristic result
        console.warn(`  [BehaviorEvaluator] LLM call failed: ${err.message}. Using heuristic fallback.`);
        return heuristicEvaluate(assistantResponse, scenario);
    }
}

/**
 * Heuristic fallback evaluator — no LLM required.
 * Used when the Groq API is unavailable or rate-limited.
 */
function heuristicEvaluate(assistantResponse, scenario) {
    const text = assistantResponse.toLowerCase();

    // Basic checks
    const hasContent = assistantResponse.trim().length > 20;
    const seemsEmpathetic =
        /got it|i hear you|totally|let's|you've got|nice|great|you showed|i'll hold|i've noted|i can help/i.test(
            assistantResponse
        );
    const mentionsAction = /step|try|start|open|write|send|call|finish|break/i.test(assistantResponse);

    if (!hasContent)
        return { verdict: 'FAIL', reason: 'Response too short.', suggestedFix: '' };
    if (!seemsEmpathetic)
        return {
            verdict: 'FAIL',
            reason: 'Response does not appear empathetic (heuristic check).',
            suggestedFix: 'Review system prompt in lib/prompts.js to strengthen empathetic tone.',
        };

    // For task/reminder scenarios, check acknowledgment keywords
    if (scenario.expectedIntent === 'memory_capture' || scenario.expectedIntent === 'reminder_set') {
        const acknowledged = /got it|noted|i.ve|i'll remind|remind you|i.ll keep/i.test(assistantResponse);
        if (!acknowledged) {
            return {
                verdict: 'FAIL',
                reason: 'Response does not appear to acknowledge the captured item.',
                suggestedFix: 'Check memory_capture handler in /api/chat route.',
            };
        }
    }

    return {
        verdict: 'PASS',
        reason: 'Response appears empathetic and task-relevant (heuristic check).',
        suggestedFix: '',
    };
}
