/**
 * dbClient.js — Supabase query helpers for test verification.
 * Uses the SERVICE ROLE key to bypass RLS and read/clean test data.
 */

import { createClient } from '@supabase/supabase-js';

let _client = null;

function getClient() {
    if (_client) return _client;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) {
        throw new Error(
            'Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in environment. ' +
            'Copy focusflow-ai-tests/.env.example to .env and fill in values.'
        );
    }
    _client = createClient(url, key, {
        auth: { persistSession: false },
    });
    return _client;
}

// ─── Memory Items ─────────────────────────────────────────────────────────────

/** Get all active memory items for a user */
export async function getMemoryItems(userId) {
    const { data, error } = await getClient()
        .from('memory_items')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'Active')
        .order('captured_at', { ascending: false });

    if (error) throw new Error(`getMemoryItems failed: ${error.message}`);
    return data || [];
}

/** Get all memory items (any status) for a user — used for deletion checks */
export async function getAllMemoryItems(userId) {
    const { data, error } = await getClient()
        .from('memory_items')
        .select('*')
        .eq('user_id', userId)
        .order('captured_at', { ascending: false });

    if (error) throw new Error(`getAllMemoryItems failed: ${error.message}`);
    return data || [];
}

/** Get the most recent Reminder item with a remind_at timestamp */
export async function getLatestReminder(userId) {
    const { data, error } = await getClient()
        .from('memory_items')
        .select('*')
        .eq('user_id', userId)
        .eq('category', 'Reminder')
        .eq('status', 'Active')
        .not('remind_at', 'is', null)
        .order('captured_at', { ascending: false })
        .limit(1);

    if (error) throw new Error(`getLatestReminder failed: ${error.message}`);
    return data?.[0] || null;
}

/** Get any memory item that matches a content string (case-insensitive) */
export async function findMemoryItemByContent(userId, content) {
    const { data, error } = await getClient()
        .from('memory_items')
        .select('*')
        .eq('user_id', userId)
        .ilike('content', `%${content}%`)
        .order('captured_at', { ascending: false })
        .limit(1);

    if (error) throw new Error(`findMemoryItemByContent failed: ${error.message}`);
    return data?.[0] || null;
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

/** Get today's session for a user */
export async function getSession(userId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data, error } = await getClient()
        .from('sessions')
        .select('*')
        .eq('user_id', userId)
        .gte('started_at', today.toISOString())
        .order('started_at', { ascending: false })
        .limit(1);

    if (error) throw new Error(`getSession failed: ${error.message}`);
    return data?.[0] || null;
}

/** Get session by ID */
export async function getSessionById(sessionId) {
    const { data, error } = await getClient()
        .from('sessions')
        .select('*')
        .eq('id', sessionId)
        .single();

    if (error) throw new Error(`getSessionById failed: ${error.message}`);
    return data;
}

// ─── Test Cleanup ─────────────────────────────────────────────────────────────

/**
 * Remove all data for a test user from all relevant tables.
 * Call this after each test run to avoid polluting the DB.
 */
export async function cleanupTestUser(userId) {
    const sb = getClient();

    // Get session IDs first (for message cleanup)
    const { data: sessions } = await sb
        .from('sessions')
        .select('id')
        .eq('user_id', userId);

    const sessionIds = (sessions || []).map((s) => s.id);

    // Delete in dependency order
    if (sessionIds.length > 0) {
        await sb.from('messages').delete().in('session_id', sessionIds);
    }
    await sb.from('memory_items').delete().eq('user_id', userId);
    await sb.from('sessions').delete().eq('user_id', userId);
    await sb.from('daily_briefings').delete().eq('user_id', userId);
    await sb.from('users').delete().eq('id', userId);
}

// ─── Test User Creation ───────────────────────────────────────────────────────

/** Create a fresh test user in Supabase */
export async function createTestUser(displayName = 'AI Test User', timezone = 'Asia/Kolkata') {
    const { data, error } = await getClient()
        .from('users')
        .insert({
            display_name: displayName,
            timezone,
            onboarding_step: 3, // skip onboarding
            main_focus: 'Test focus',
            biggest_struggle: 'Test struggle',
        })
        .select()
        .single();

    if (error) throw new Error(`createTestUser failed: ${error.message}`);
    return data;
}

/** Create a session for a test user */
export async function createTestSession(userId) {
    const { data, error } = await getClient()
        .from('sessions')
        .insert({
            user_id: userId,
            started_at: new Date().toISOString(),
            briefing_delivered: false,
            active_task_id: null,
            check_in_due_at: null,
        })
        .select()
        .single();

    if (error) throw new Error(`createTestSession failed: ${error.message}`);
    return data;
}

export async function seedMessage(sessionId, role, content) {
    const { data, error } = await getClient()
        .from('messages')
        .insert({
            session_id: sessionId,
            role,
            content,
        })
        .select()
        .single();
    if (error) throw new Error(`seedMessage failed: ${error.message}`);
    return data;
}

/** Insert a memory item directly (for setting up preconditions) */
export async function seedMemoryItem(userId, content, category = 'Task', remindAt = null) {
    const { data, error } = await getClient()
        .from('memory_items')
        .insert({
            user_id: userId,
            content,
            category,
            status: 'Active',
            captured_at: new Date().toISOString(),
            remind_at: remindAt,
            surfaced_at: null,
        })
        .select()
        .single();

    if (error) throw new Error(`seedMemoryItem failed: ${error.message}`);
    return data;
}
