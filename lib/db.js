import { isDemoMode, supabaseAdmin as supabase } from './supabase';
import { v4 as uuidv4 } from 'uuid';

// ────────────────────────────────────────────
//  IN-MEMORY DEMO STORE (Persisted in global to survive HMR)
// ────────────────────────────────────────────
if (!global.demoStore) {
    global.demoStore = {
        users: new Map(),
        memoryItems: new Map(),     // userId -> item[]
        sessions: new Map(),        // date-key -> session
        messages: new Map(),        // sessionId -> msg[]
        dailyBriefings: new Map(),  // `${userId}_${date}` -> briefing
        evalEvents: new Map(),      // sessionId -> event[]
    };

    // Seed a demo user on first load
    const DEMO_USER_ID = '00000000-0000-0000-0000-000000000001';
    global.demoStore.users.set(DEMO_USER_ID, {
        id: DEMO_USER_ID,
        display_name: 'Friend',
        timezone: 'Asia/Kolkata',
        created_at: new Date().toISOString(),
        onboarding_step: 0,
        main_focus: null,
        biggest_struggle: null,
    });
}
const demoStore = global.demoStore;

// ────────────────────────────────────────────
//  USER
// ────────────────────────────────────────────
export async function createUser(displayName = 'Friend', timezone = null) {
    const user = {
        id: uuidv4(),
        display_name: displayName,
        timezone,
        created_at: new Date().toISOString(),
        onboarding_step: 0,
        main_focus: null,
        biggest_struggle: null,
    };
    if (isDemoMode) {
        demoStore.users.set(user.id, user);
        return user;
    }
    const { data, error } = await supabase
        .from('users')
        .insert({ display_name: displayName, timezone })
        .select()
        .single();
    if (error) throw error;
    return data;
}

export async function getUser(userId) {
    if (isDemoMode) {
        return demoStore.users.get(userId) || null;
    }
    const { data, error } = await supabase.from('users').select('*').eq('id', userId).single();
    if (error) throw error;
    return data;
}

export async function updateUser(userId, updates) {
    if (isDemoMode) {
        const user = demoStore.users.get(userId);
        if (user) Object.assign(user, updates);
        return user;
    }
    const { data, error } = await supabase.from('users').update(updates).eq('id', userId).select().single();
    if (error) throw error;
    return data;
}

// ────────────────────────────────────────────
//  MESSAGES
// ────────────────────────────────────────────
export async function saveMessage(sessionId, role, content) {
    const msg = {
        id: uuidv4(),
        session_id: sessionId,
        role,
        content,
        created_at: new Date().toISOString(),
    };

    if (isDemoMode) {
        if (!demoStore.messages.has(sessionId)) {
            demoStore.messages.set(sessionId, []);
        }
        demoStore.messages.get(sessionId).push(msg);
        return msg;
    }

    const { data, error } = await supabase.from('messages').insert(msg).select().single();
    if (error) throw error;
    return data;
}

export async function clearMessages(sessionId) {
    if (isDemoMode) {
        demoStore.messages.set(sessionId, []);
        return;
    }
    const { error } = await supabase.from('messages').delete().eq('session_id', sessionId);
    if (error) throw error;
}

export async function getMessages(sessionId, limit = 20) {
    if (isDemoMode) {
        const msgs = demoStore.messages.get(sessionId) || [];
        return msgs.slice(-limit);
    }
    const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true })
        .limit(limit);
    if (error) throw error;
    return data || [];
}

// ────────────────────────────────────────────
//  MEMORY ITEMS
// ────────────────────────────────────────────
export async function saveMemoryItem(userId, content, category = 'Note', remindAt = null) {
    const item = {
        id: uuidv4(),
        user_id: userId,
        content,
        category,
        status: 'Active',
        captured_at: new Date().toISOString(),
        surfaced_at: null,
        remind_at: remindAt,
    };

    if (isDemoMode) {
        if (!demoStore.memoryItems.has(userId)) {
            demoStore.memoryItems.set(userId, []);
        }
        // Dedup: skip if near-identical content already exists
        const existing = demoStore.memoryItems.get(userId).filter(i => i.status === 'Active');
        const normContent = content.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
        const newTokens = normContent.split(' ').filter(w => w.length > 2);
        for (const e of existing) {
            const norm = (e.content || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
            const overlap = newTokens.length ? newTokens.filter(t => norm.includes(t)).length / newTokens.length : 0;
            if (overlap >= 0.8) return e;
        }
        demoStore.memoryItems.get(userId).push(item);
        return item;
    }

    // Dedup: check recent 20 active items for near-identical content before inserting
    const { data: recent } = await supabase.from('memory_items').select('id, content')
        .eq('user_id', userId).eq('status', 'Active')
        .order('captured_at', { ascending: false }).limit(20);
    if (recent && recent.length > 0) {
        const normContent = content.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
        const newTokens = normContent.split(' ').filter(w => w.length > 2);
        if (newTokens.length > 0) {
            for (const e of recent) {
                const norm = (e.content || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
                const overlap = newTokens.filter(t => norm.includes(t)).length / newTokens.length;
                if (overlap >= 0.8) return e; // already saved, skip insert
            }
        }
    }

    const { data, error } = await supabase.from('memory_items').insert(item).select().single();
    if (error) throw error;
    return data;
}

export async function getMemoryItems(userId) {
    if (isDemoMode) {
        const items = demoStore.memoryItems.get(userId) || [];
        return items.filter((i) => i.status === 'Active').sort(
            (a, b) => new Date(b.captured_at) - new Date(a.captured_at)
        );
    }
    const { data, error } = await supabase
        .from('memory_items')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'Active')
        .order('captured_at', { ascending: false });
    if (error) throw error;
    return data || [];
}

export async function deleteMemoryItem(userId, itemId) {
    if (isDemoMode) {
        const items = demoStore.memoryItems.get(userId) || [];
        const item = items.find((i) => i.id === itemId);
        if (item) item.status = 'Archived';
        return item;
    }
    const { data, error } = await supabase
        .from('memory_items')
        .update({ status: 'Archived' })
        .eq('id', itemId)
        .eq('user_id', userId)
        .select()
        .single();
    if (error) throw error;
    return data;
}

export async function deleteLastMemoryItem(userId) {
    if (isDemoMode) {
        const items = (demoStore.memoryItems.get(userId) || []).filter((i) => i.status === 'Active');
        if (items.length === 0) return null;
        const last = items[items.length - 1];
        last.status = 'Archived';
        return last;
    }
    const { data: items, error: fetchError } = await supabase
        .from('memory_items')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'Active')
        .order('captured_at', { ascending: false })
        .limit(1);
    if (fetchError) throw fetchError;
    if (!items || items.length === 0) return null;
    const { data, error } = await supabase
        .from('memory_items')
        .update({ status: 'Archived' })
        .eq('id', items[0].id)
        .select()
        .single();
    if (error) throw error;
    return data;
}


export async function deleteMemoryItemByContent(userId, searchText) {
    const needle = (searchText || '').toLowerCase().trim();
    if (!needle) return null;

    const normalize = (text = '') => text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const queryTokens = normalize(needle).split(' ').filter((w) => w.length > 2);
    if (queryTokens.length === 0) return null;

    const scoreItem = (itemText = '') => {
        const normalized = normalize(itemText);
        return queryTokens.reduce((score, token) => score + (normalized.includes(token) ? 1 : 0), 0);
    };

    if (isDemoMode) {
        const items = (demoStore.memoryItems.get(userId) || [])
            .filter((i) => i.status === 'Active')
            .sort((a, b) => new Date(b.captured_at) - new Date(a.captured_at));

        let best = null;
        let bestScore = 0;
        for (const item of items) {
            const score = scoreItem(item.content || '');
            if (score > bestScore) {
                best = item;
                bestScore = score;
            }
        }

        if (!best || bestScore < 1) return null;
        best.status = 'Archived';
        return best;
    }

    const { data: candidates, error } = await supabase
        .from('memory_items')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'Active')
        .order('captured_at', { ascending: false })
        .limit(50);

    if (error || !candidates || candidates.length === 0) return null;

    let best = null;
    let bestScore = 0;
    for (const item of candidates) {
        const score = scoreItem(item.content || '');
        if (score > bestScore) {
            best = item;
            bestScore = score;
        }
    }

    if (!best || bestScore < 1) return null;

    const { data, error: updateError } = await supabase
        .from('memory_items')
        .update({ status: 'Archived' })
        .eq('id', best.id)
        .select()
        .single();
    if (updateError) throw updateError;

    return data || null;
}
export async function archiveAllDuplicates(userId, contentHint) {
    const needle = (contentHint || '').toLowerCase().trim();
    if (!needle) return 0;

    const normalize = (text = '') => text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const queryTokens = normalize(needle).split(' ').filter(w => w.length > 2);
    if (queryTokens.length === 0) return 0;

    const score = (itemText = '') => {
        const norm = normalize(itemText);
        return queryTokens.reduce((s, t) => s + (norm.includes(t) ? 1 : 0), 0);
    };

    if (isDemoMode) {
        const items = (demoStore.memoryItems.get(userId) || [])
            .filter(i => i.status === 'Active')
            .sort((a, b) => new Date(b.captured_at) - new Date(a.captured_at));
        const matches = items.filter(i => score(i.content) >= 1);
        // Keep the first (most recent), archive the rest
        matches.slice(1).forEach(i => { i.status = 'Archived'; });
        return matches.length - 1;
    }

    const { data: candidates, error } = await supabase
        .from('memory_items').select('*')
        .eq('user_id', userId).eq('status', 'Active')
        .order('captured_at', { ascending: false }).limit(100);

    if (error || !candidates || candidates.length === 0) return 0;

    const matches = candidates.filter(i => score(i.content) >= 1);
    if (matches.length <= 1) return 0; // nothing to deduplicate

    // Keep most recent (first), archive all others
    const toArchive = matches.slice(1).map(i => i.id);
    await supabase.from('memory_items').update({ status: 'Archived' })
        .in('id', toArchive);

    return toArchive.length;
}

/**
 * Archive ALL active memory items matching a content hint (for user-requested deletion).
 */
export async function deleteMatchingMemoryItems(userId, contentHint) {
    const needle = (contentHint || '').toLowerCase().trim();
    if (!needle) return 0;

    const normalize = (text = '') => text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const queryTokens = normalize(needle).split(' ').filter(w => w.length > 2);
    if (queryTokens.length === 0) return 0;

    const score = (itemText = '') => {
        const norm = normalize(itemText);
        return queryTokens.reduce((s, t) => s + (norm.includes(t) ? 1 : 0), 0);
    };

    if (isDemoMode) {
        const items = (demoStore.memoryItems.get(userId) || []).filter(i => i.status === 'Active');
        const matches = items.filter(i => score(i.content) >= 1);
        matches.forEach(i => { i.status = 'Archived'; });
        return matches.length;
    }

    const { data: candidates, error } = await supabase
        .from('memory_items').select('*')
        .eq('user_id', userId).eq('status', 'Active')
        .order('captured_at', { ascending: false }).limit(100);

    if (error || !candidates || candidates.length === 0) return 0;

    const matches = candidates.filter(i => score(i.content) >= 1);
    if (matches.length === 0) return 0;

    const toArchive = matches.map(i => i.id);
    await supabase.from('memory_items').update({ status: 'Archived' }).in('id', toArchive);
    return toArchive.length;
}

export async function updateMemoryItem(userId, itemId, updates) {
    if (isDemoMode) {
        const items = demoStore.memoryItems.get(userId) || [];
        const item = items.find((i) => i.id === itemId);
        if (item) Object.assign(item, updates);
        return item || null;
    }
    const { data, error } = await supabase
        .from('memory_items')
        .update(updates)
        .eq('id', itemId)
        .eq('user_id', userId)
        .select()
        .single();
    if (error) throw error;
    return data;
}

export async function markMemoryItemDone(userId, itemId) {
    if (isDemoMode) {
        const items = demoStore.memoryItems.get(userId) || [];
        const item = items.find((i) => i.id === itemId);
        if (item) item.status = 'Done';
        return;
    }
    const { error } = await supabase
        .from('memory_items')
        .update({ status: 'Done' })
        .eq('id', itemId)
        .eq('user_id', userId);
    if (error) throw error;
}

export async function findMemoryItemByContent(userId, searchText) {
    const needle = (searchText || '').toLowerCase().trim();

    if (isDemoMode) {
        const tasks = (demoStore.memoryItems.get(userId) || [])
            .filter((i) => i.status === 'Active' && i.category === 'Task')
            .sort((a, b) => new Date(b.captured_at) - new Date(a.captured_at));
        if (!needle) return tasks[0] || null;

        // Prefer the most recently captured task that loosely matches.
        const exactish = tasks.find((i) => i.content.toLowerCase().includes(needle));
        return exactish || tasks[0] || null;
    }

    // First pass: content match against active tasks.
    let query = supabase
        .from('memory_items')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'Active')
        .eq('category', 'Task')
        .order('captured_at', { ascending: false })
        .limit(1);

    if (needle) {
        query = query.ilike('content', `%${needle}%`);
    }

    const { data, error } = await query.maybeSingle();
    if (error) return null;
    return data || null;
}

export async function getLatestActiveTask(userId) {
    if (isDemoMode) {
        const tasks = (demoStore.memoryItems.get(userId) || [])
            .filter((i) => i.status === 'Active' && i.category === 'Task')
            .sort((a, b) => new Date(b.captured_at) - new Date(a.captured_at));
        return tasks[0] || null;
    }

    const { data, error } = await supabase
        .from('memory_items')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'Active')
        .eq('category', 'Task')
        .order('captured_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) return null;
    return data || null;
}

// ────────────────────────────────────────────
//  REMINDERS (time-based memory items)
// ────────────────────────────────────────────
// Scan ALL users for due reminders — used by the server-side cron job
export async function getAllDueReminders() {
    const now = new Date().toISOString();
    if (isDemoMode) {
        const all = [];
        for (const [, items] of demoStore.memoryItems) {
            all.push(...items.filter(
                (i) => i.status === 'Active' && i.remind_at && i.remind_at <= now && !i.surfaced_at
            ));
        }
        return all;
    }
    const { data, error } = await supabase
        .from('memory_items')
        .select('*')
        .eq('status', 'Active')
        .not('remind_at', 'is', null)
        .is('surfaced_at', null)
        .lte('remind_at', now);
    if (error) throw error;
    return data || [];
}

export async function getDueReminders(userId) {
    const now = new Date().toISOString();
    if (isDemoMode) {
        const items = demoStore.memoryItems.get(userId) || [];
        return items.filter(
            (i) => i.status === 'Active' && i.remind_at && i.remind_at <= now && !i.surfaced_at
        );
    }
    const { data, error } = await supabase
        .from('memory_items')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'Active')
        .not('remind_at', 'is', null)
        .is('surfaced_at', null)
        .lte('remind_at', now);
    if (error) throw error;
    return data || [];
}

export async function rescheduleLastReminder(userId, newRemindAt) {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    if (isDemoMode) {
        const items = demoStore.memoryItems.get(userId) || [];
        // Find the last reminder: active with remind_at, OR recently surfaced
        const candidate = [...items].reverse().find(
            (i) => i.category === 'Reminder' &&
                (
                    (i.status === 'Active' && i.remind_at) ||
                    (i.surfaced_at && i.surfaced_at >= tenMinutesAgo)
                )
        );
        if (candidate) {
            candidate.remind_at = newRemindAt;
            candidate.surfaced_at = null;
            candidate.status = 'Active';
        }
        return candidate || null;
    }
    // Supabase: find the last active reminder or recently surfaced one
    const { data: active, error: activeError } = await supabase
        .from('memory_items')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'Active')
        .eq('category', 'Reminder')
        .not('remind_at', 'is', null)
        .order('captured_at', { ascending: false })
        .limit(1);
    if (activeError) throw activeError;

    const { data: surfaced, error: surfacedError } = await supabase
        .from('memory_items')
        .select('*')
        .eq('user_id', userId)
        .eq('category', 'Reminder')
        .gte('surfaced_at', tenMinutesAgo)
        .order('surfaced_at', { ascending: false })
        .limit(1);
    if (surfacedError) throw surfacedError;

    const candidate = (active && active[0]) || (surfaced && surfaced[0]);
    if (!candidate) return null;

    const { data, error } = await supabase
        .from('memory_items')
        .update({ remind_at: newRemindAt, surfaced_at: null, status: 'Active' })
        .eq('id', candidate.id)
        .select()
        .single();
    if (error) throw error;
    return data;
}

export async function markReminderSurfaced(userId, itemId) {
    if (isDemoMode) {
        const items = demoStore.memoryItems.get(userId) || [];
        const item = items.find((i) => i.id === itemId);
        if (item && !item.surfaced_at) {
            item.surfaced_at = new Date().toISOString();
            item.remind_at = null;
        }
        return item;
    }
    const { data, error } = await supabase
        .from('memory_items')
        .update({ surfaced_at: new Date().toISOString(), remind_at: null })
        .eq('id', itemId)
        .eq('user_id', userId)
        .is('surfaced_at', null)
        .select()
        .single();
    if (error) throw error;
    return data;
}

// ────────────────────────────────────────────
//  SESSIONS
// ────────────────────────────────────────────
function todayKey(userId) {
    const d = new Date();
    return `${userId}_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function getOrCreateSession(userId) {
    const key = todayKey(userId);

    if (isDemoMode) {
        if (demoStore.sessions.has(key)) {
            return demoStore.sessions.get(key);
        }
        const session = {
            id: uuidv4(),
            user_id: userId,
            started_at: new Date().toISOString(),
            briefing_delivered: false,
            active_task_id: null,
            check_in_due_at: null,
        };
        demoStore.sessions.set(key, session);
        // Initialize empty messages array for this session
        demoStore.messages.set(session.id, []);
        return session;
    }

    // Check for existing session today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { data: existing, error: fetchError } = await supabase
        .from('sessions')
        .select('*')
        .eq('user_id', userId)
        .gte('started_at', today.toISOString())
        .order('started_at', { ascending: false })
        .limit(1);
    if (fetchError) throw fetchError;

    if (existing && existing.length > 0) return existing[0];

    const session = {
        id: uuidv4(),
        user_id: userId,
        started_at: new Date().toISOString(),
        briefing_delivered: false,
        active_task_id: null,
        check_in_due_at: null,
    };
    const { data, error } = await supabase.from('sessions').insert(session).select().single();
    if (error) throw error;
    return data;
}

// Atomically consume a due check-in so it can only be delivered once.
export async function consumeDueCheckIn(userId) {
    const session = await getOrCreateSession(userId);
    if (!session?.check_in_due_at) {
        return { consumed: false, dueAt: null };
    }

    const nowIso = new Date().toISOString();
    if (session.check_in_due_at > nowIso) {
        return { consumed: false, dueAt: null };
    }

    const dueAt = session.check_in_due_at;

    if (isDemoMode) {
        for (const [, s] of demoStore.sessions) {
            if (s.id === session.id && s.check_in_due_at === dueAt) {
                s.check_in_due_at = null;
                return { consumed: true, dueAt };
            }
        }
        return { consumed: false, dueAt: null };
    }

    const { data, error } = await supabase
        .from('sessions')
        .update({ check_in_due_at: null })
        .eq('id', session.id)
        .eq('check_in_due_at', dueAt)
        .select('id')
        .single();

    if (error || !data) {
        return { consumed: false, dueAt: null };
    }
    return { consumed: true, dueAt };
}

// ────────────────────────────────────────────
//  DAILY BRIEFINGS
// ────────────────────────────────────────────
export async function getTodayBriefing(userId) {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    if (isDemoMode) {
        const key = `${userId}_${today}`;
        return demoStore.dailyBriefings.get(key) || null;
    }
    const { data, error } = await supabase
        .from('daily_briefings')
        .select('*')
        .eq('user_id', userId)
        .eq('briefing_date', today)
        .single();
    if (error && error.code !== 'PGRST116') throw error;
    return data || null;
}

export async function saveTodayBriefing(userId, content) {
    const today = new Date().toISOString().slice(0, 10);
    if (isDemoMode) {
        const key = `${userId}_${today}`;
        const briefing = {
            id: uuidv4(),
            user_id: userId,
            briefing_date: today,
            content,
            created_at: new Date().toISOString(),
        };
        demoStore.dailyBriefings.set(key, briefing);
        return briefing;
    }
    const { data, error } = await supabase
        .from('daily_briefings')
        .upsert(
            { user_id: userId, briefing_date: today, content },
            { onConflict: 'user_id,briefing_date' }
        )
        .select()
        .single();
    if (error) throw error;
    return data;
}

// Cross-session recent messages for AI context
export async function getRecentMessages(userId, limit = 30) {
    if (isDemoMode) {
        // Collect messages from all sessions belonging to this user
        const allMessages = [];
        for (const [, session] of demoStore.sessions) {
            if (session.user_id === userId) {
                const msgs = demoStore.messages.get(session.id) || [];
                allMessages.push(...msgs);
            }
        }
        return allMessages
            .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
            .slice(-limit);
    }
    // Get the user's 3 most recent sessions, then their messages
    const { data: sessions, error: sessionsError } = await supabase
        .from('sessions')
        .select('id')
        .eq('user_id', userId)
        .order('started_at', { ascending: false })
        .limit(3);
    if (sessionsError) throw sessionsError;
    if (!sessions || sessions.length === 0) return [];
    const sessionIds = sessions.map((s) => s.id);
    const { data, error } = await supabase
        .from('messages')
        .select('*')
        .in('session_id', sessionIds)
        .order('created_at', { ascending: false })
        .limit(limit);
    if (error) throw error;
    return (data || []).reverse();
}

// ────────────────────────────────────────────
//  PUSH SUBSCRIPTIONS
// ────────────────────────────────────────────
export async function savePushSubscription(userId, subscription) {
    if (isDemoMode) return;
    const { error } = await supabase.from('push_subscriptions').upsert({
        user_id: userId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        updated_at: new Date().toISOString(),
    }, { onConflict: 'endpoint' });
    if (error) throw error;
}

export async function getPushSubscriptions(userId) {
    if (isDemoMode) return [];
    const { data, error } = await supabase.from('push_subscriptions').select('*').eq('user_id', userId);
    if (error) throw error;
    return data || [];
}

export async function deletePushSubscription(endpoint) {
    if (isDemoMode) return;
    const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
    if (error) throw error;
}

export async function getPushSubscriptionsForUsers(userIds) {
    if (isDemoMode || !userIds.length) return [];
    const { data, error } = await supabase.from('push_subscriptions').select('*').in('user_id', userIds);
    if (error) throw error;
    return data || [];
}

export async function updateSession(sessionId, updates) {
    if (isDemoMode) {
        for (const [, session] of demoStore.sessions) {
            if (session.id === sessionId) {
                Object.assign(session, updates);
                return session;
            }
        }
        return null;
    }
    const { data, error } = await supabase
        .from('sessions')
        .update(updates)
        .eq('id', sessionId)
        .select()
        .single();
    if (error) throw error;
    return data;
}

// ────────────────────────────────────────────
//  EVAL EVENTS (tool call logging for eval system)
// ────────────────────────────────────────────
export async function saveEvalEvent({ sessionId, userId, messageId = null, eventType, toolName = null, toolArgs = null, toolResult = null, llmIteration = 1, latencyMs = null }) {
    const event = {
        id: uuidv4(),
        session_id: sessionId,
        user_id: userId,
        message_id: messageId,
        event_type: eventType,
        tool_name: toolName,
        tool_args: toolArgs,
        tool_result: toolResult,
        llm_iteration: llmIteration,
        latency_ms: latencyMs,
        created_at: new Date().toISOString(),
    };

    if (isDemoMode) {
        if (!demoStore.evalEvents) demoStore.evalEvents = new Map();
        if (!demoStore.evalEvents.has(sessionId)) demoStore.evalEvents.set(sessionId, []);
        demoStore.evalEvents.get(sessionId).push(event);
        return event;
    }

    const { data, error } = await supabase.from('eval_events').insert(event).select().single();
    if (error) {
        console.warn('[saveEvalEvent] Failed to save eval event:', error.message);
        return null;
    }
    return data;
}

export async function getEvalEvents(sessionId, limit = 100) {
    if (isDemoMode) {
        if (!demoStore.evalEvents) return [];
        return (demoStore.evalEvents.get(sessionId) || []).slice(-limit);
    }
    const { data, error } = await supabase
        .from('eval_events')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true })
        .limit(limit);
    if (error) return [];
    return data || [];
}
