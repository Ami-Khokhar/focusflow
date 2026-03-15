// ────────────────────────────────────────────
//  FocusFlow — LangGraph State Graph
//  Replaces agent.js + streaming.js
// ────────────────────────────────────────────

import { StateGraph, MessagesAnnotation, MemorySaver, InMemoryStore } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatGroq } from "@langchain/groq";
import { SystemMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import { getGroqApiKey, isDemoMode } from "./keys.js";
import { filterForbiddenWords } from "./prompts.js";

// ── Checkpointer ────────────────────────────
let checkpointer;
if (isDemoMode || !process.env.SUPABASE_DB_URL) {
    checkpointer = new MemorySaver();
} else {
    try {
        const { PostgresSaver } = await import("@langchain/langgraph-checkpoint-postgres");
        checkpointer = PostgresSaver.fromConnString(process.env.SUPABASE_DB_URL);
        await checkpointer.setup();
    } catch (e) {
        console.warn("[Graph] PostgresSaver init failed, falling back to MemorySaver:", e.message);
        checkpointer = new MemorySaver();
    }
}

// ── Store ──────────────────────────────────
let store;
if (isDemoMode || !process.env.SUPABASE_DB_URL) {
    store = new InMemoryStore();
} else {
    try {
        const { PostgresStore } = await import("@langchain/langgraph-checkpoint-postgres/store");
        store = PostgresStore.fromConnString(process.env.SUPABASE_DB_URL);
        await store.setup();
    } catch (e) {
        console.warn("[Graph] PostgresStore init failed, falling back to InMemoryStore:", e.message);
        store = new InMemoryStore();
    }
}

// ── Model factory ───────────────────────────
function createModel() {
    if (isDemoMode) return null;
    return new ChatGroq({
        apiKey: getGroqApiKey(),
        model: "llama-3.3-70b-versatile",
        temperature: 0.7,
        maxTokens: 1500,
    });
}

// ── Graph builder ───────────────────────────
// Keywords in user message that justify calling save_memory / delete_memory
const SAVE_TRIGGERS = /\b(remind|remember|save|note|capture|store|set a reminder|don'?t forget)\b/i;
const DELETE_TRIGGERS = /\b(forget|delete|remove|clear|drop|get rid of|nvm|never\s?mind)\b/i;

function buildGraph(tools) {
    const model = createModel();
    if (!model) return null; // demo mode

    const boundModel = model.bindTools(tools);

    // Agent node: invoke the LLM with Store-enriched context
    async function callModel(state, config) {
        const userId = config?.configurable?.userId;
        const storeInstance = config?.store;

        let messages = state.messages;

        // Enrich system prompt with cross-session memory from Store
        if (userId && storeInstance && messages[0]?.constructor?.name === "SystemMessage") {
            try {
                // Find last user message for relevance search
                const lastUserMsg = [...messages].reverse().find(
                    m => m._getType?.() === "human" || m.constructor?.name === "HumanMessage"
                );

                // All 4 Store reads in parallel
                const [profileItem, episodes, preferences, relevantItems] = await Promise.all([
                    storeInstance.get([userId, "profile"], "main"),
                    storeInstance.search([userId, "episodes"], { limit: 3 }),
                    storeInstance.get([userId, "preferences"], "main"),
                    lastUserMsg
                        ? storeInstance.search([userId, "items"], { query: lastUserMsg.content, limit: 5 })
                        : Promise.resolve([]),
                ]);

                // Build memory section
                const sections = [];
                if (profileItem?.value) {
                    const p = profileItem.value;
                    const facts = p.facts?.length ? p.facts.join("; ") : "";
                    if (facts) sections.push(`ABOUT USER: ${facts}`);
                }
                if (episodes?.length) {
                    sections.push("RECENT SESSIONS:\n" + episodes.map(
                        e => `- ${e.value.date}: ${e.value.summary}`
                    ).join("\n"));
                }
                if (relevantItems?.length) {
                    sections.push("RELEVANT SAVED ITEMS:\n" + relevantItems.map(
                        e => `- [${e.value.category}] ${e.value.content}`
                    ).join("\n"));
                }
                if (preferences?.value?.rules?.length) {
                    sections.push("USER PREFERENCES: " + preferences.value.rules.join("; "));
                }

                if (sections.length > 0) {
                    const enrichment = "\n\nCROSS-SESSION MEMORY:\n" + sections.join("\n");
                    messages = [
                        new SystemMessage(messages[0].content + enrichment),
                        ...messages.slice(1),
                    ];
                }
            } catch (e) {
                console.warn("[Graph] Store read failed, using original prompt:", e.message);
            }
        }

        const response = await boundModel.invoke(messages);
        return { messages: [response] };
    }

    // Tool node: execute tool calls with guardrails
    const toolNode = new ToolNode(tools);

    // Guard wrapper: block hallucinated tool calls
    async function guardedTools(state) {
        const lastMsg = state.messages[state.messages.length - 1];
        const toolCalls = lastMsg.tool_calls || [];

        // Find the last human message to check triggers
        let userMessage = "";
        for (let i = state.messages.length - 1; i >= 0; i--) {
            if (state.messages[i]._getType?.() === "human" || state.messages[i].constructor?.name === "HumanMessage") {
                userMessage = state.messages[i].content;
                break;
            }
        }

        // Check for hallucinated tool calls
        const blockedCalls = [];
        const allowedCalls = [];
        for (const tc of toolCalls) {
            if (tc.name === "save_memory" && !SAVE_TRIGGERS.test(userMessage)) {
                blockedCalls.push(tc);
            } else if (tc.name === "delete_memory" && !DELETE_TRIGGERS.test(userMessage)) {
                blockedCalls.push(tc);
            } else {
                allowedCalls.push(tc);
            }
        }

        if (blockedCalls.length > 0) {
            console.warn(`[Graph] Blocked ${blockedCalls.length} hallucinated tool call(s)`);
        }

        // If all calls were blocked, return tool messages saying skipped
        if (allowedCalls.length === 0 && blockedCalls.length > 0) {
            const { ToolMessage } = await import("@langchain/core/messages");
            return {
                messages: blockedCalls.map(tc => new ToolMessage({
                    content: "Skipped — no explicit request from user.",
                    tool_call_id: tc.id,
                }))
            };
        }

        // If some calls were blocked but others allowed, modify the message
        if (blockedCalls.length > 0) {
            const { ToolMessage } = await import("@langchain/core/messages");
            // Execute allowed calls via ToolNode
            const modifiedMsg = { ...lastMsg, tool_calls: allowedCalls };
            const modifiedState = { ...state, messages: [...state.messages.slice(0, -1), modifiedMsg] };
            const result = await toolNode.invoke(modifiedState);
            // Add skipped messages for blocked calls
            const blockedMsgs = blockedCalls.map(tc => new ToolMessage({
                content: "Skipped — no explicit request from user.",
                tool_call_id: tc.id,
            }));
            return { messages: [...(result.messages || []), ...blockedMsgs] };
        }

        // All calls allowed — delegate to ToolNode
        return toolNode.invoke(state);
    }

    // Router: continue to tools or end
    function shouldContinue(state) {
        const lastMsg = state.messages[state.messages.length - 1];
        if (lastMsg.tool_calls?.length > 0) return "tools";
        return "__end__";
    }

    const graph = new StateGraph(MessagesAnnotation)
        .addNode("agent", callModel)
        .addNode("tools", guardedTools)
        .addEdge("__start__", "agent")
        .addConditionalEdges("agent", shouldContinue)
        .addEdge("tools", "agent")
        .compile({ checkpointer, store });

    return graph;
}

// ── Background memory extraction (fire-and-forget) ──
// Called AFTER streaming completes — never blocks the user response.
async function writeMemory(userMessage, assistantMessage, userId, storeInstance) {
    if (!userId || !storeInstance || isDemoMode) return;
    if (!userMessage || !assistantMessage) return;

    try {
        const extractor = new ChatGroq({
            apiKey: getGroqApiKey(),
            model: "llama-3.1-8b-instant",
            temperature: 0,
            maxTokens: 150,
        });

        const extraction = await extractor.invoke([
            { role: "system", content: `Extract NEW facts from this exchange. Return JSON only, no markdown.
{"profile_facts":["fact1"],"preference":null}
- profile_facts: new things about the user (name, habits, goals, interests). Empty array if none.
- preference: behavioral preference like "prefers short answers". null if none.` },
            { role: "user", content: `User: ${userMessage.slice(0, 300)}\nAssistant: ${assistantMessage.slice(0, 300)}` },
        ]);

        // Extract JSON robustly — handle prose-wrapped LLM output
        let jsonStr = extraction.content.replace(/```json?\n?|\n?```/g, "").trim();
        const braceStart = jsonStr.indexOf("{");
        const braceEnd = jsonStr.lastIndexOf("}");
        if (braceStart === -1 || braceEnd === -1) return;
        jsonStr = jsonStr.slice(braceStart, braceEnd + 1);
        const parsed = JSON.parse(jsonStr);

        if (parsed.profile_facts?.length > 0) {
            const existing = await storeInstance.get([userId, "profile"], "main");
            const existingFacts = existing?.value?.facts || [];
            const merged = [...new Set([...existingFacts, ...parsed.profile_facts])].slice(0, 20);
            await storeInstance.put([userId, "profile"], "main", {
                ...existing?.value,
                facts: merged,
            });
        }

        if (parsed.preference) {
            const existing = await storeInstance.get([userId, "preferences"], "main");
            const rules = existing?.value?.rules || [];
            if (!rules.includes(parsed.preference)) {
                await storeInstance.put([userId, "preferences"], "main", {
                    rules: [...rules, parsed.preference].slice(0, 10),
                });
            }
        }
    } catch (e) {
        console.warn("[WriteMemory] Extraction failed:", e.message);
    }
}

// ── Demo streaming (no LLM) ────────────────
const DEMO_RESPONSES = [
    "I hear you. **What would feel most helpful right now** — breaking something down into steps, or capturing a thought so you don't lose it?",
    "Thanks for sharing that. Want to talk through it, or would you like me to note it down for later?",
    "Got it! Is there anything specific you'd like help starting on today? No pressure — whenever you're ready.",
];

async function streamDemoResponse({ onToken }) {
    const response = DEMO_RESPONSES[Math.floor(Math.random() * DEMO_RESPONSES.length)];
    const words = response.split(" ");
    let fullText = "";
    for (let i = 0; i < words.length; i++) {
        const token = (i === 0 ? "" : " ") + words[i];
        fullText += token;
        onToken(token);
        await new Promise((r) => setTimeout(r, 15 + Math.random() * 25));
    }
    return fullText;
}

// ── Convert DB messages to LangChain ────────
function convertHistory(messages) {
    return messages
        .filter((m) => !(m.role === "assistant" && /^Hey! You asked me to remind you:/.test(m.content)))
        .filter((m) => m.content && m.content.trim())
        .map((m) => {
            if (m.role === "user") return new HumanMessage(m.content);
            if (m.role === "assistant") return new AIMessage(m.content);
            return new HumanMessage(m.content);
        });
}

export {
    buildGraph,
    checkpointer,
    store,
    writeMemory,
    createModel,
    convertHistory,
    streamDemoResponse,
    filterForbiddenWords,
    isDemoMode,
    SystemMessage,
    HumanMessage,
    AIMessage,
};
