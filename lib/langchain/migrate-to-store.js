#!/usr/bin/env node
// ────────────────────────────────────────────
//  FocusFlow — One-time data migration to LangGraph Store
//  Run: node lib/langchain/migrate-to-store.js
// ────────────────────────────────────────────

import { createClient } from "@supabase/supabase-js";
import { ChatGroq } from "@langchain/groq";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const DB_URL = process.env.SUPABASE_DB_URL;

if (!SUPABASE_URL || !SUPABASE_KEY || !DB_URL) {
    console.error("Missing env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_DB_URL");
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function main() {
    // Init PostgresStore
    const { PostgresStore } = await import("@langchain/langgraph-checkpoint-postgres/store");
    const store = PostgresStore.fromConnString(DB_URL);
    await store.setup();
    console.log("[Migrate] Store initialized");

    // 1. Get all users
    const { data: users, error: usersErr } = await supabase.from("users").select("*");
    if (usersErr) throw usersErr;
    console.log(`[Migrate] Found ${users.length} users`);

    for (const user of users) {
        const userId = user.id;
        console.log(`\n[Migrate] Processing user: ${user.display_name || userId}`);

        // 2. Write profile
        const existing = await store.get([userId, "profile"], "main");
        if (!existing?.value) {
            const facts = [];
            if (user.display_name && user.display_name !== "Friend") facts.push(`Name: ${user.display_name}`);
            if (user.main_focus) facts.push(`Main focus: ${user.main_focus}`);
            if (user.biggest_struggle) facts.push(`Biggest struggle: ${user.biggest_struggle}`);
            if (facts.length > 0) {
                await store.put([userId, "profile"], "main", { facts });
                console.log(`  [Profile] Wrote ${facts.length} facts`);
            }
        } else {
            console.log("  [Profile] Already exists, skipping");
        }

        // 3. Migrate active memory items
        const { data: items, error: itemsErr } = await supabase
            .from("memory_items")
            .select("*")
            .eq("user_id", userId)
            .eq("status", "Active")
            .order("captured_at", { ascending: false });
        if (itemsErr) {
            console.warn(`  [Items] Error fetching items: ${itemsErr.message}`);
            continue;
        }

        let itemCount = 0;
        const migratedIds = [];
        for (const item of items || []) {
            const key = `item_${item.id}`;
            const existingItem = await store.get([userId, "items"], key);
            if (existingItem?.value) continue; // idempotent skip

            await store.put([userId, "items"], key, {
                content: item.content,
                category: item.category,
                remind_at: item.remind_at,
                captured_at: item.captured_at,
            });
            migratedIds.push(item.id);
            itemCount++;
        }
        if (itemCount > 0) {
            console.log(`  [Items] Migrated ${itemCount} items`);
            // Mark as synced
            await supabase
                .from("memory_items")
                .update({ memory_type: "synced" })
                .in("id", migratedIds);
        }

        // 4. Summarize last 5 sessions as episodes
        const { data: sessions, error: sessErr } = await supabase
            .from("sessions")
            .select("*")
            .eq("user_id", userId)
            .order("started_at", { ascending: false })
            .limit(5);
        if (sessErr) {
            console.warn(`  [Episodes] Error fetching sessions: ${sessErr.message}`);
            continue;
        }

        const groqKey = process.env.GROQ_API_KEY;
        if (!groqKey) {
            console.warn("  [Episodes] No GROQ_API_KEY — skipping summarization");
            continue;
        }

        const llm = new ChatGroq({
            apiKey: groqKey,
            model: "llama-3.1-8b-instant",
            temperature: 0.3,
            maxTokens: 150,
        });

        for (const session of sessions || []) {
            const dateKey = `session_${session.started_at?.slice(0, 10) || "unknown"}`;
            const existingEp = await store.get([userId, "episodes"], dateKey);
            if (existingEp?.value) continue; // idempotent skip

            const { data: msgs } = await supabase
                .from("messages")
                .select("role, content")
                .eq("session_id", session.id)
                .order("created_at", { ascending: true })
                .limit(50);

            if (!msgs || msgs.length < 4) continue;

            try {
                const transcript = msgs.map(m => `${m.role}: ${m.content}`).join("\n");
                const result = await llm.invoke([
                    { role: "system", content: "Summarize this conversation in 2-3 sentences. Focus on decisions, tasks, emotional state, and commitments. Be concise." },
                    { role: "user", content: transcript },
                ]);

                if (result.content) {
                    await store.put([userId, "episodes"], dateKey, {
                        summary: result.content,
                        date: session.started_at?.slice(0, 10),
                        sessionId: session.id,
                    });
                    console.log(`  [Episode] ${dateKey}: ${result.content.slice(0, 80)}...`);
                }

                // Rate limit: 1 req/sec
                await new Promise(r => setTimeout(r, 1000));
            } catch (e) {
                console.warn(`  [Episode] Failed for ${dateKey}: ${e.message}`);
            }
        }
    }

    console.log("\n[Migrate] Done!");
    process.exit(0);
}

main().catch(e => {
    console.error("[Migrate] Fatal:", e);
    process.exit(1);
});
