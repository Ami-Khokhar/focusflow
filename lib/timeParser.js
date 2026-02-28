// ────────────────────────────────────────────
//  FocusFlow — Time Parser
//  Extract reminder timestamps from natural language
// ────────────────────────────────────────────

/**
 * Parse a reminder time from text.
 * Supports: "at 9am", "at 3:30pm", "in 2 hours", "in 30 minutes",
 *           "tomorrow at 3pm", "tonight"
 *
 * @param {string} text - The raw reminder content (after "remind me" is stripped)
 * @returns {{ content: string, remindAt: string | null }}
 *   content  — cleaned text with time expression removed
 *   remindAt — ISO timestamp string, or null if no time found
 */
export function parseRemindTime(text) {
    const now = new Date();
    let remindAt = null;
    let cleaned = text;

    // Pattern 1: "in N hours/minutes"
    const relativeMatch = text.match(/\bin\s+(\d+)\s*(hours?|minutes?|mins?|hrs?)\b/i);
    if (relativeMatch) {
        const amount = parseInt(relativeMatch[1], 10);
        const unit = relativeMatch[2].toLowerCase();
        const ms = unit.startsWith('h') ? amount * 60 * 60 * 1000 : amount * 60 * 1000;
        remindAt = new Date(now.getTime() + ms);
        cleaned = text.replace(relativeMatch[0], '').trim();
    }

    // Pattern 2: "tomorrow at H[:MM][am/pm]"
    if (!remindAt) {
        const tomorrowMatch = text.match(/\btomorrow\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
        if (tomorrowMatch) {
            const tomorrow = new Date(now);
            tomorrow.setDate(tomorrow.getDate() + 1);
            let hour = parseInt(tomorrowMatch[1], 10);
            const min = tomorrowMatch[2] ? parseInt(tomorrowMatch[2], 10) : 0;
            const ampm = (tomorrowMatch[3] || '').toLowerCase();
            if (ampm === 'pm' && hour < 12) hour += 12;
            if (ampm === 'am' && hour === 12) hour = 0;
            tomorrow.setHours(hour, min, 0, 0);
            remindAt = tomorrow;
            cleaned = text.replace(tomorrowMatch[0], '').trim();
        }
    }

    // Pattern 3: "at H[:MM][am/pm]" (today, or tomorrow if that time already passed)
    if (!remindAt) {
        const atMatch = text.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
        if (atMatch) {
            let hour = parseInt(atMatch[1], 10);
            const min = atMatch[2] ? parseInt(atMatch[2], 10) : 0;
            const ampm = (atMatch[3] || '').toLowerCase();
            if (ampm === 'pm' && hour < 12) hour += 12;
            if (ampm === 'am' && hour === 12) hour = 0;
            const target = new Date(now);
            target.setHours(hour, min, 0, 0);
            if (target <= now) {
                target.setDate(target.getDate() + 1);
            }
            remindAt = target;
            cleaned = text.replace(atMatch[0], '').trim();
        }
    }

    // Pattern 4: "tonight"
    if (!remindAt) {
        const tonightMatch = text.match(/\btonight\b/i);
        if (tonightMatch) {
            const target = new Date(now);
            target.setHours(20, 0, 0, 0);
            if (target <= now) {
                target.setDate(target.getDate() + 1);
            }
            remindAt = target;
            cleaned = text.replace(tonightMatch[0], '').trim();
        }
    }

    // Clean up: remove dangling "to" from phrases like "at 9am to take meds" → "take meds"
    cleaned = cleaned
        .replace(/^\s*to\s+/i, '')
        .replace(/\s{2,}/g, ' ')
        .trim();

    return {
        content: cleaned,
        remindAt: remindAt ? remindAt.toISOString() : null,
    };
}
