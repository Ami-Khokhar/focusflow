// ────────────────────────────────────────────
//  FocusFlow — Session Summarizer
//  Generates cross-session summaries using 8b-instant
// ────────────────────────────────────────────

import { ChatGroq } from "@langchain/groq";
import { getGroqApiKey, isDemoMode } from "./keys.js";
import { getPreviousSession, getMessages } from "../db.js";

/**
 * Summarize a thread's messages into a 2-3 sentence episode.
 * Uses the cheap 8b-instant model.
 * @param {Array} threadMessages - Array of {role, content} objects
 * @returns {string|null} Summary text, or null if too few messages
 */
export async function summarizeThread(threadMessages) {
    if (!threadMessages || threadMessages.length < 4) return null;

    if (isDemoMode) {
        // In demo mode, just return the last assistant message as a summary
        const lastAssistant = [...threadMessages].reverse().find(m => m.role === "assistant");
        return lastAssistant ? `Previous session: ${lastAssistant.content.slice(0, 150)}` : null;
    }

    try {
        const llm = new ChatGroq({
            apiKey: getGroqApiKey(),
            model: "llama-3.1-8b-instant",
            temperature: 0.3,
            maxTokens: 150,
        });

        const transcript = threadMessages.map(m => `${m.role}: ${m.content}`).join("\n");

        const summary = await llm.invoke([
            { role: "system", content: "Summarize this conversation in 2-3 sentences. Focus on decisions, tasks, emotional state, and commitments. Be concise." },
            { role: "user", content: transcript },
        ]);

        return summary.content || null;
    } catch (e) {
        console.warn("[Summarizer] Failed:", e.message);
        return null;
    }
}

/**
 * Summarize the previous session and write to Store as an episode.
 * Called in the background when a new session is created.
 */
export async function summarizePreviousSession(userId, store) {
    if (!store) return;
    const prevSession = await getPreviousSession(userId);
    if (!prevSession) return;

    const messages = await getMessages(prevSession.id, 50);
    if (messages.length < 4) return;

    const summary = await summarizeThread(messages);
    if (!summary) return;

    const dateKey = `session_${prevSession.started_at?.slice(0, 10) || Date.now()}`;
    await store.put([userId, "episodes"], dateKey, {
        summary,
        date: prevSession.started_at?.slice(0, 10) || new Date().toISOString().slice(0, 10),
        sessionId: prevSession.id,
    });
}
