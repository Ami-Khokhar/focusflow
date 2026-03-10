// ────────────────────────────────────────────
//  FocusFlow — LangChain Tool Definitions
//  Each tool wraps existing lib/db.js functions
// ────────────────────────────────────────────

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import {
    saveMemoryItem,
    deleteLastMemoryItem,
    deleteMatchingMemoryItems,
    archiveAllDuplicates,
    rescheduleLastReminder,
    updateUser,
    updateSession,
    markMemoryItemDone,
    findMemoryItemByContent,
    getLatestActiveTask,
} from '../db.js';

/**
 * Factory: creates all tools with userId/sessionId/timezone closed over.
 * Called once per request — no global state.
 */
export function createTools(userId, sessionId, timezone, user) {
    const saveMemory = tool(
        async ({ content, category, remind_at, minutes_from_now }) => {
            if (!content) return 'No content provided.';
            // Prefer server-computed time from minutes_from_now over LLM-computed remind_at
            let finalRemindAt = remind_at || null;
            if (minutes_from_now && minutes_from_now > 0) {
                finalRemindAt = new Date(Date.now() + minutes_from_now * 60 * 1000).toISOString();
            }
            const item = await saveMemoryItem(userId, content, category || 'Note', finalRemindAt);
            const type = category === 'Reminder' && finalRemindAt ? 'reminder' : category?.toLowerCase() || 'note';
            if (finalRemindAt) {
                const displayTime = new Date(finalRemindAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: timezone });
                return `Saved ${type}: "${content}" (reminder at ${displayTime})`;
            }
            return `Saved ${type}: "${content}"`;
        },
        {
            name: 'save_memory',
            description: 'Save something the user explicitly asks to remember. ONLY call when the user says words like "remind me", "remember", "save this", "note that". NEVER call for emotional messages, casual chat, or general questions.',
            schema: z.object({
                content: z.string().describe('The thing to remember, clean and concise'),
                category: z.enum(['Task', 'Reminder', 'Idea', 'Note', 'Link']).describe('Reminder if it has a time, Task if actionable, Idea for creative thoughts, Link for URLs, Note for everything else'),
                remind_at: z.string().nullable().optional().describe("ISO 8601 datetime for an absolute reminder time. Prefer minutes_from_now for relative times like 'in 5 minutes'."),
                minutes_from_now: z.number().nullable().optional().describe("Minutes from now for the reminder. Use this for relative times like 'in 2 minutes', 'in 1 hour' (=60). Server computes the exact timestamp. Takes priority over remind_at."),
            }),
        }
    );

    const deleteMemory = tool(
        async ({ content_hint }) => {
            if (content_hint && content_hint.length >= 4) {
                const count = await deleteMatchingMemoryItems(userId, content_hint);
                return count > 0 ? `Removed ${count} item(s) matching "${content_hint}".` : 'Nothing matched — nothing to remove.';
            }
            const item = await deleteLastMemoryItem(userId);
            return item ? `Removed: "${item.content}"` : 'Nothing to remove.';
        },
        {
            name: 'delete_memory',
            description: 'Delete or forget something the user explicitly asks to remove. Use when the user says "forget that", "delete that", "remove that".',
            schema: z.object({
                content_hint: z.string().optional().describe('Description of what to delete. Leave empty to delete the most recently saved item.'),
            }),
        }
    );

    const rescheduleReminder = tool(
        async ({ new_time }) => {
            if (!new_time) return 'No new time provided.';
            const item = await rescheduleLastReminder(userId, new_time);
            return item ? `Rescheduled to ${new_time}.` : 'No reminder found to reschedule.';
        },
        {
            name: 'reschedule_reminder',
            description: 'Move an existing reminder to a new time. Use when the user says "snooze", "push that back", "reschedule".',
            schema: z.object({
                new_time: z.string().describe('ISO 8601 datetime for the new reminder time.'),
            }),
        }
    );

    const completeTask = tool(
        async ({ content_hint }) => {
            const matchedTask = content_hint ? await findMemoryItemByContent(userId, content_hint) : null;
            const taskItem = matchedTask || await getLatestActiveTask(userId);
            if (taskItem) {
                await markMemoryItemDone(userId, taskItem.id);
                return `Marked done: "${taskItem.content}"`;
            }
            return 'No active task found to complete.';
        },
        {
            name: 'complete_task',
            description: 'Mark a task as done. Use when the user says they finished, completed, or checked off a task.',
            schema: z.object({
                content_hint: z.string().optional().describe('Description of the completed task. Leave empty to mark the most recent active task.'),
            }),
        }
    );

    const setCheckinTimer = tool(
        async ({ minutes }) => {
            const mins = minutes || 25;
            const checkInDueAt = new Date(Date.now() + mins * 60 * 1000).toISOString();
            await updateSession(sessionId, { check_in_due_at: checkInDueAt });
            return `Check-in timer set for ${mins} minutes.`;
        },
        {
            name: 'set_checkin_timer',
            description: 'Set a check-in timer. Use ONLY when the user agrees to a check-in (e.g. "yes", "sure" after you offered one).',
            schema: z.object({
                minutes: z.number().optional().default(25).describe('Minutes until check-in. Default: 25.'),
            }),
        }
    );

    const updateProfile = tool(
        async ({ display_name, main_focus, biggest_struggle }) => {
            const updates = {};
            if (display_name) updates.display_name = display_name.trim();
            if (main_focus) updates.main_focus = main_focus.trim().slice(0, 200);
            if (biggest_struggle) updates.biggest_struggle = biggest_struggle.trim().slice(0, 200);

            // Auto-advance onboarding step
            const currentStep = user?.onboarding_step ?? 3;
            if (currentStep < 3) {
                const mergedUser = { ...user, ...updates };
                if (mergedUser.display_name && mergedUser.main_focus && mergedUser.biggest_struggle) {
                    updates.onboarding_step = 3;
                } else if (mergedUser.display_name && mergedUser.main_focus) {
                    updates.onboarding_step = 2;
                } else if (mergedUser.display_name) {
                    updates.onboarding_step = 1;
                }
            }

            if (Object.keys(updates).length > 0) {
                await updateUser(userId, updates);
                return `Profile updated: ${Object.keys(updates).join(', ')}`;
            }
            return 'No profile updates provided.';
        },
        {
            name: 'update_profile',
            description: "Update the user's profile information. Use during onboarding to save name, main focus, or biggest struggle.",
            schema: z.object({
                display_name: z.string().optional().describe('What the user wants to be called.'),
                main_focus: z.string().optional().describe('What the user most wants help with.'),
                biggest_struggle: z.string().optional().describe("What usually gets in the user's way."),
            }),
        }
    );

    return [saveMemory, deleteMemory, rescheduleReminder, completeTask, setCheckinTimer, updateProfile];
}
