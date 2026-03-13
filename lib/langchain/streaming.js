// ────────────────────────────────────────────
//  FocusFlow — SSE Streaming Adapter
//  Uses ChatGroq.stream() with tool call loop
// ────────────────────────────────────────────

import { filterForbiddenWords } from './prompts.js';
import { SystemMessage, HumanMessage, AIMessage } from '@langchain/core/messages';
import { ToolMessage } from '@langchain/core/messages';

const DEMO_RESPONSES = [
    "I hear you. **What would feel most helpful right now** — breaking something down into steps, or capturing a thought so you don't lose it?",
    "Thanks for sharing that. Want to talk through it, or would you like me to note it down for later?",
    "Got it! Is there anything specific you'd like help starting on today? No pressure — whenever you're ready.",
];

/**
 * Stream model response as SSE events, handling tool calls in a loop.
 * @returns {string} The full response text (for DB save).
 */
const MEMORY_MUTATING_TOOLS = new Set(['save_memory', 'delete_memory', 'complete_task', 'reschedule_reminder']);

// Keywords in user message that justify calling save_memory
const SAVE_TRIGGERS = /\b(remind|remember|save|note|capture|store|set a reminder|don'?t forget)\b/i;
const DELETE_TRIGGERS = /\b(forget|delete|remove|clear|drop|get rid of)\b/i;

export async function streamAgentResponse({
    model,
    tools,
    systemPrompt,
    chatHistory,
    userMessage,
    onToken,
    onMemoryChanged,
    onEvalEvent,
}) {
    const toolMap = {};
    for (const t of tools) {
        toolMap[t.name] = t;
    }

    const messages = [
        new SystemMessage(systemPrompt),
        ...chatHistory,
        new HumanMessage(userMessage),
    ];

    // Keep a copy of the original messages (before tool call mutations) for fallback
    const originalMessages = [...messages];

    const requestStart = Date.now();
    const MAX_REQUEST_MS = 45000; // Total timeout — don't let a single request run 5+ minutes
    let fullText = '';
    let savedText = '';
    let iterations = 0;
    const maxIterations = 3;

    while (iterations < maxIterations) {
        if (Date.now() - requestStart > MAX_REQUEST_MS) {
            console.warn('[StreamAgent] Total request timeout exceeded');
            break;
        }
        iterations++;
        let responseObj;

        try {
            // Await the full structured output (JSON object matching FlowyResponseSchema)
            responseObj = await model.invoke(messages);
            
            if (!responseObj) {
                console.warn('[StreamAgent] Empty response object received');
                break;
            }

        } catch (error) {
            console.error(`[StreamAgent] Error (iteration ${iterations}):`, error?.message);

            const isRetryable = error?.status === 429 || error?.message?.includes('rate') || error?.message?.includes('Connection error') || error?.message?.includes('ECONNRESET');
            if (iterations < maxIterations && isRetryable) {
                onEvalEvent?.({ eventType: 'rate_limit', toolName: null, toolArgs: null, toolResult: error?.message, llmIteration: iterations, latencyMs: Date.now() - requestStart });
                await new Promise((r) => setTimeout(r, 2000 * iterations));
                continue;
            }
            break;
        }

        const toolCalls = responseObj.tool_calls || [];
        const iterationText = responseObj.message || '';
        
        if (iterationText) {
            fullText += iterationText;
        }

        if (toolCalls.length === 0) {
            // Final iteration (no tools) — we can stream out the message
            savedText = iterationText;
            
            // Simulate streaming the final text so the UI doesn't visually break,
            // chunking it to look like typing
            if (savedText && onToken) {
                const words = savedText.split(' ');
                for (let i = 0; i < words.length; i++) {
                    const t = (i === 0 ? '' : ' ') + words[i];
                    onToken(t);
                    // Add a tiny artificial delay to simulate typing realistically
                    await new Promise(r => setTimeout(r, 10 + Math.random() * 20));
                }
            }
            break;
        }

        // We have tools to call. Add the LLM's structured intent to the messages array so it has context of what it did.
        // Since we are using structured output, we simulate an AIMessage containing the text and tool calls.
        const lcToolCalls = toolCalls.map(tc => ({
            name: tc.name,
            args: tc.args,
            id: 'call_' + Math.random().toString(36).slice(2)
        }));
        
        messages.push(new AIMessage({ 
            content: iterationText, 
            tool_calls: lcToolCalls 
        }));

        // Execute each tool call (with guardrails against hallucinated calls)
        let memoryChanged = false;
        for (const tc of lcToolCalls) {
            try {
                // Guard: block save_memory unless user actually asked to save/remind
                if (tc.name === 'save_memory' && !SAVE_TRIGGERS.test(userMessage)) {
                    console.warn(`[Tool] Blocked hallucinated save_memory for: "${userMessage}"`);
                    onEvalEvent?.({ eventType: 'hallucination_blocked', toolName: tc.name, toolArgs: tc.args, toolResult: 'blocked', llmIteration: iterations, latencyMs: Date.now() - requestStart });
                    messages.push(new ToolMessage({ content: 'Skipped — no save requested. Do NOT mention saving, noting, or remembering anything.', tool_call_id: tc.id }));
                    continue;
                }
                // Guard: block delete_memory unless user actually asked to delete/remove
                if (tc.name === 'delete_memory' && !DELETE_TRIGGERS.test(userMessage)) {
                    console.warn(`[Tool] Blocked hallucinated delete_memory for: "${userMessage}"`);
                    onEvalEvent?.({ eventType: 'hallucination_blocked', toolName: tc.name, toolArgs: tc.args, toolResult: 'blocked', llmIteration: iterations, latencyMs: Date.now() - requestStart });
                    messages.push(new ToolMessage({ content: 'Skipped — no delete requested. Do NOT mention deleting or removing anything.', tool_call_id: tc.id }));
                    continue;
                }

                const toolFn = toolMap[tc.name];
                if (!toolFn) {
                    console.warn(`[Tool] Unknown tool: ${tc.name}`);
                    messages.push(new ToolMessage({ content: `Unknown tool: ${tc.name}`, tool_call_id: tc.id }));
                    continue;
                }
                const result = await toolFn.invoke(tc.args);
                console.log(`[Tool] ${tc.name} →`, result);
                onEvalEvent?.({ eventType: 'tool_call', toolName: tc.name, toolArgs: tc.args, toolResult: String(result), llmIteration: iterations, latencyMs: Date.now() - requestStart });
                messages.push(new ToolMessage({ content: String(result), tool_call_id: tc.id }));
                if (MEMORY_MUTATING_TOOLS.has(tc.name)) memoryChanged = true;
            } catch (e) {
                console.error(`[Tool] ${tc.name} failed:`, e.message);
                messages.push(new ToolMessage({ content: `Error: ${e.message}`, tool_call_id: tc.id }));
            }
        }

        // Refresh system prompt with current memory after mutations
        if (memoryChanged && onMemoryChanged) {
            try {
                const freshPrompt = await onMemoryChanged();
                messages[0] = new SystemMessage(freshPrompt);
            } catch (e) {
                console.warn('[StreamAgent] Failed to refresh system prompt:', e.message);
            }
        }
    }

    // If no tool calls happened at all (single iteration), savedText may not be set
    if (!savedText) savedText = fullText;

    // Strip any tool call XML that may span chunk boundaries
    savedText = savedText.replace(/<function=\w+>[\s\S]*?<\/function>/g, '').trim();
    // Re-apply forbidden word filter to final saved text (belt-and-suspenders)
    savedText = filterForbiddenWords(savedText);

    // Fallback if empty — retry with 8b model, no tools, using ORIGINAL messages only
    if (!savedText.trim()) {
        console.warn(`[StreamAgent] Empty response for: "${userMessage}". Retrying with fallback model.`);
        try {
            const { ChatGroq } = await import('@langchain/groq');
            const fallbackLlm = new ChatGroq({
                apiKey: process.env.GROQ_API_KEY,
                model: 'llama-3.1-8b-instant',
                temperature: 0.7,
                maxTokens: 300,
            });
            // Use only system prompt + last few human/AI messages (no ToolMessages)
            const fallbackMessages = [
                originalMessages[0], // system
                ...originalMessages.slice(-4), // last few conversation turns + current user msg
            ];
            const fallbackRes = await fallbackLlm.invoke(fallbackMessages);
            savedText = filterForbiddenWords(fallbackRes?.message || '').trim();
            if (savedText) {
                console.log(`[StreamAgent] Fallback succeeded: "${savedText.slice(0, 80)}..."`);
                onEvalEvent?.({ eventType: 'fallback', toolName: null, toolArgs: null, toolResult: savedText?.slice(0, 200), llmIteration: iterations, latencyMs: Date.now() - requestStart });
                onToken(savedText);
            }
        } catch (e) {
            console.error('[StreamAgent] Fallback failed:', e.message);
        }
        if (!savedText.trim()) {
            savedText = "Hey! I'm here. What's on your mind?";
            onToken(savedText);
        }
    }

    return savedText;
}

/**
 * Stream a demo response (no LLM call).
 */
export async function streamDemoResponse({ onToken }) {
    const response = DEMO_RESPONSES[Math.floor(Math.random() * DEMO_RESPONSES.length)];
    const words = response.split(' ');
    let fullText = '';

    for (let i = 0; i < words.length; i++) {
        const token = (i === 0 ? '' : ' ') + words[i];
        fullText += token;
        onToken(token);
        await new Promise((r) => setTimeout(r, 15 + Math.random() * 25));
    }

    return fullText;
}
