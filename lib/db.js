import { isDemoMode, supabase } from './supabase';
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
    };

    // Seed a demo user on first load
    const DEMO_USER_ID = '00000000-0000-0000-0000-000000000001';
    global.demoStore.users.set(DEMO_USER_ID, {
        id: DEMO_USER_ID,
        display_name: 'Friend',
        timezone: 'Asia/Kolkata',
        created_at: new Date().toISOString(),
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
    };
    if (isDemoMode) {
        demoStore.users.set(user.id, user);
        return user;
    }
    const { data } = await supabase
        .from('users')
        .insert({ display_name: displayName, timezone })
        .select()
        .single();
    return data;
}

export async function getUser(userId) {
    if (isDemoMode) {
        return demoStore.users.get(userId) || null;
    }
    const { data } = await supabase.from('users').select('*').eq('id', userId).single();
    return data;
}

export async function updateUser(userId, updates) {
    if (isDemoMode) {
        const user = demoStore.users.get(userId);
        if (user) Object.assign(user, updates);
        return user;
    }
    const { data } = await supabase.from('users').update(updates).eq('id', userId).select().single();
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

    const { data } = await supabase.from('messages').insert(msg).select().single();
    return data;
}

export async function getMessages(sessionId, limit = 20) {
    if (isDemoMode) {
        const msgs = demoStore.messages.get(sessionId) || [];
        return msgs.slice(-limit);
    }
    const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true })
        .limit(limit);
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
        demoStore.memoryItems.get(userId).push(item);
        return item;
    }

    const { data } = await supabase.from('memory_items').insert(item).select().single();
    return data;
}

export async function getMemoryItems(userId) {
    if (isDemoMode) {
        const items = demoStore.memoryItems.get(userId) || [];
        return items.filter((i) => i.status === 'Active').sort(
            (a, b) => new Date(b.captured_at) - new Date(a.captured_at)
        );
    }
    const { data } = await supabase
        .from('memory_items')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'Active')
        .order('captured_at', { ascending: false });
    return data || [];
}

export async function deleteMemoryItem(userId, itemId) {
    if (isDemoMode) {
        const items = demoStore.memoryItems.get(userId) || [];
        const item = items.find((i) => i.id === itemId);
        if (item) item.status = 'Archived';
        return item;
    }
    const { data } = await supabase
        .from('memory_items')
        .update({ status: 'Archived' })
        .eq('id', itemId)
        .eq('user_id', userId)
        .select()
        .single();
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
    const { data: items } = await supabase
        .from('memory_items')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'Active')
        .order('captured_at', { ascending: false })
        .limit(1);
    if (!items || items.length === 0) return null;
    const { data } = await supabase
        .from('memory_items')
        .update({ status: 'Archived' })
        .eq('id', items[0].id)
        .select()
        .single();
    return data;
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
    const { data } = await supabase
        .from('memory_items')
        .select('*')
        .eq('status', 'Active')
        .not('remind_at', 'is', null)
        .is('surfaced_at', null)
        .lte('remind_at', now);
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
    const { data } = await supabase
        .from('memory_items')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'Active')
        .not('remind_at', 'is', null)
        .is('surfaced_at', null)
        .lte('remind_at', now);
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
    const { data: active } = await supabase
        .from('memory_items')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'Active')
        .eq('category', 'Reminder')
        .not('remind_at', 'is', null)
        .order('captured_at', { ascending: false })
        .limit(1);

    const { data: surfaced } = await supabase
        .from('memory_items')
        .select('*')
        .eq('user_id', userId)
        .eq('category', 'Reminder')
        .gte('surfaced_at', tenMinutesAgo)
        .order('surfaced_at', { ascending: false })
        .limit(1);

    const candidate = (active && active[0]) || (surfaced && surfaced[0]);
    if (!candidate) return null;

    const { data } = await supabase
        .from('memory_items')
        .update({ remind_at: newRemindAt, surfaced_at: null, status: 'Active' })
        .eq('id', candidate.id)
        .select()
        .single();
    return data;
}

export async function markReminderSurfaced(userId, itemId) {
    if (isDemoMode) {
        const items = demoStore.memoryItems.get(userId) || [];
        const item = items.find((i) => i.id === itemId);
        if (item) {
            item.surfaced_at = new Date().toISOString();
            item.remind_at = null;
        }
        return item;
    }
    const { data } = await supabase
        .from('memory_items')
        .update({ surfaced_at: new Date().toISOString(), remind_at: null })
        .eq('id', itemId)
        .eq('user_id', userId)
        .select()
        .single();
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
    const { data: existing } = await supabase
        .from('sessions')
        .select('*')
        .eq('user_id', userId)
        .gte('started_at', today.toISOString())
        .order('started_at', { ascending: false })
        .limit(1);

    if (existing && existing.length > 0) return existing[0];

    const session = {
        id: uuidv4(),
        user_id: userId,
        started_at: new Date().toISOString(),
        briefing_delivered: false,
        active_task_id: null,
        check_in_due_at: null,
    };
    const { data } = await supabase.from('sessions').insert(session).select().single();
    return data;
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
    const { data } = await supabase
        .from('daily_briefings')
        .select('*')
        .eq('user_id', userId)
        .eq('briefing_date', today)
        .single();
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
    const { data } = await supabase
        .from('daily_briefings')
        .upsert(
            { user_id: userId, briefing_date: today, content },
            { onConflict: 'user_id,briefing_date' }
        )
        .select()
        .single();
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
    const { data: sessions } = await supabase
        .from('sessions')
        .select('id')
        .eq('user_id', userId)
        .order('started_at', { ascending: false })
        .limit(3);
    if (!sessions || sessions.length === 0) return [];
    const sessionIds = sessions.map((s) => s.id);
    const { data } = await supabase
        .from('messages')
        .select('*')
        .in('session_id', sessionIds)
        .order('created_at', { ascending: false })
        .limit(limit);
    return (data || []).reverse();
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
    const { data } = await supabase
        .from('sessions')
        .update(updates)
        .eq('id', sessionId)
        .select()
        .single();
    return data;
}
