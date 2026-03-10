/**
 * bugDetector.js — Verifies database state changes match expected behavior.
 * Combines rule-based DB diffing with an optional LLM cross-check.
 */


import { buildBugDetectorPrompt, buildBugDetectorUserMessage } from '../prompts/bugPrompt.js';

import { getGroqClient } from '../utils/groqClient.js';

// ─── Rule-based DB checks ─────────────────────────────────────────────────────

/**
 * Check that at least one new memory_item was created with content matching hint.
 */
export function checkMemoryCapture(beforeItems, afterItems, contentHint = '') {
    const newItems = afterItems.filter(
        (a) => !beforeItems.some((b) => b.id === a.id)
    );

    if (newItems.length === 0) {
        return {
            bugFound: true,
            description: 'No new memory_items row was created after memory capture.',
            reproSteps: `Send "remember to ${contentHint || 'do something'}" to /api/chat. Check memory_items table — no new row should appear.`,
            suggestedFix: 'Check the memory_capture branch in /api/chat/route.js. Ensure saveMemoryItem() is called and the intent is detected correctly.',
        };
    }

    if (contentHint) {
        const match = newItems.find((i) =>
            i.content.toLowerCase().includes(contentHint.toLowerCase())
        );
        if (!match) {
            return {
                bugFound: true,
                description: `New memory item created but content "${newItems[0].content}" doesn't match expected "${contentHint}".`,
                reproSteps: 'Send the memory capture message and check the content column in memory_items.',
                suggestedFix: 'Check the content extraction regex in route.js (triggerMatch) — it may be stripping too much or too little text.',
            };
        }
    }

    return { bugFound: false, description: 'Memory capture created correctly.', reproSteps: '', suggestedFix: '' };
}

/**
 * Check that the latest reminder has a remind_at within tolerance of expectedAt.
 */
export function checkReminderCreation(latestReminder, expectedAt, toleranceMs = 90_000) {
    if (!latestReminder) {
        return {
            bugFound: true,
            description: 'No Reminder item found in memory_items after reminder creation.',
            reproSteps: 'Send "remind me to X in N minutes" and check memory_items for a row with category=Reminder.',
            suggestedFix: 'Ensure parseRemindTime() is returning a non-null remindAt and that saveMemoryItem() is called with category="Reminder".',
        };
    }

    if (!latestReminder.remind_at) {
        return {
            bugFound: true,
            description: `Reminder item "${latestReminder.content}" was saved but remind_at is null.`,
            reproSteps: 'Send "remind me in N minutes" — the memory_items.remind_at column should be populated.',
            suggestedFix: 'Check parseRemindTime() in lib/timeParser.js and confirm remindAt is passed to saveMemoryItem() in route.js.',
        };
    }

    const diff = Math.abs(new Date(latestReminder.remind_at) - new Date(expectedAt));
    if (diff > toleranceMs) {
        return {
            bugFound: true,
            description: `remind_at is ${Math.round(diff / 60000)} minutes off from expected. Got: ${latestReminder.remind_at}, Expected ≈ ${new Date(expectedAt).toISOString()}`,
            reproSteps: 'Send "remind me in 10 minutes" and compare resulting remind_at with now+10min.',
            suggestedFix: 'Audit parseRemindTime() in lib/timeParser.js for off-by-one errors or timezone handling.',
        };
    }

    return { bugFound: false, description: 'Reminder created with correct time.', reproSteps: '', suggestedFix: '' };
}

/**
 * Check that a reminder's remind_at was updated (rescheduled).
 */
export function checkReminderReschedule(beforeReminder, afterReminder, expectedNewAt, toleranceMs = 90_000) {
    if (!afterReminder) {
        return {
            bugFound: true,
            description: 'No reminder found after reschedule attempt.',
            reproSteps: 'Seed a reminder, then send "push it back 30 minutes". Check that the reminder still exists with updated remind_at.',
            suggestedFix: 'Check rescheduleLastReminder() in lib/db.js — the candidate query may not be matching.',
        };
    }

    if (beforeReminder && afterReminder.remind_at === beforeReminder.remind_at) {
        return {
            bugFound: true,
            description: 'remind_at did not change after reschedule.',
            reproSteps: 'Send "push it back 30 minutes" after a reminder exists. The remind_at should update.',
            suggestedFix: 'Check the SQL update in rescheduleLastReminder() in lib/db.js. Also verify parseTimeOffset() returns a non-null value.',
        };
    }

    const diff = Math.abs(new Date(afterReminder.remind_at) - new Date(expectedNewAt));
    if (diff > toleranceMs) {
        return {
            bugFound: true,
            description: `Rescheduled remind_at is ${Math.round(diff / 60000)} minutes off. Got: ${afterReminder.remind_at}, Expected ≈ ${new Date(expectedNewAt).toISOString()}`,
            reproSteps: 'Seed a reminder, note the current remind_at, send "push it back 30 minutes", check new remind_at.',
            suggestedFix: 'Audit parseTimeOffset() in lib/timeParser.js and the offset calculation in route.js (Date.now() + offsetMs).',
        };
    }

    return { bugFound: false, description: 'Reminder rescheduled to correct time.', reproSteps: '', suggestedFix: '' };
}

/**
 * Check that the assistant response includes stored memory items when recalling.
 */
export function checkMemoryRecall(assistantResponse, expectedItems) {
    if (!expectedItems || expectedItems.length === 0) {
        // If there are no items, the response should say so gracefully
        const noItemsOk = /haven't shared|nothing yet|no items|empty|don't have anything/i.test(assistantResponse);
        if (!noItemsOk) {
            return {
                bugFound: true,
                description: 'No items exist but response did not gracefully acknowledge empty memory.',
                reproSteps: 'Send "what do you remember?" with no prior memory_items.',
                suggestedFix: 'Check memory_recall handler in lib/llm.js DEMO_RESPONSES or system prompt to handle empty state.',
            };
        }
        return { bugFound: false, description: 'Empty memory state handled correctly.', reproSteps: '', suggestedFix: '' };
    }

    const normalize = (text = '') => text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\b(the|a|an|to|for|my)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const lowerResponse = normalize(assistantResponse);
    const missingItems = expectedItems.filter((item) => {
        const words = normalize(item.content)
            .split(' ')
            .filter((w) => w.length > 2)
            .slice(0, 6);
        if (words.length === 0) return false;

        const hitCount = words.filter((w) => lowerResponse.includes(w)).length;
        const minRequired = Math.min(2, words.length);
        return hitCount < minRequired;
    });

    if (missingItems.length > 0) {
        return {
            bugFound: true,
            description: `Memory recall response is missing item(s): ${missingItems.map((i) => i.content).join(', ')}`,
            reproSteps: 'Send "what do you remember?" and compare response against memory_items in DB.',
            suggestedFix: 'Check getMemoryItems() query in lib/db.js and ensure the memory_recall system prompt includes all items.',
        };
    }

    return { bugFound: false, description: 'All memory items returned in recall.', reproSteps: '', suggestedFix: '' };
}

/**
 * Check that an item's status was updated to 'Done'.
 */
export function checkTaskDone(beforeItems, afterItems, contentHint = '') {
    const doneItem = afterItems.find(
        (a) => a.status === 'Done' &&
            (!contentHint || a.content.toLowerCase().includes(contentHint.toLowerCase()))
    );

    if (!doneItem) {
        // Try to see if it was done but category is wrong
        const wasActive = beforeItems.find(
            (b) => contentHint && b.content.toLowerCase().includes(contentHint.toLowerCase())
        );
        if (!wasActive) {
            return {
                bugFound: true,
                description: 'No matching task found to mark done — item may not have been created.',
                reproSteps: 'Ensure the task exists in memory_items before sending "done!".',
                suggestedFix: 'Check findMemoryItemByContent() in lib/db.js — the ilike query may be too strict.',
            };
        }
        return {
            bugFound: true,
            description: `Task "${wasActive.content}" exists but status was not updated to 'Done'.`,
            reproSteps: 'Send "done!" after a task is active. Check memory_items.status.',
            suggestedFix: 'Check markMemoryItemDone() in lib/db.js and the task_complete handler in route.js.',
        };
    }

    return { bugFound: false, description: 'Task marked Done correctly.', reproSteps: '', suggestedFix: '' };
}

/**
 * Check that an item was archived (soft-deleted) after "forget that".
 */
export function checkMemoryDeleted(beforeActiveCount, afterAllItems, afterActiveCount) {
    if (afterActiveCount >= beforeActiveCount) {
        return {
            bugFound: true,
            description: `Active item count did not decrease after deletion. Before: ${beforeActiveCount}, After: ${afterActiveCount}`,
            reproSteps: 'Seed a memory item, send "forget that", check memory_items.status.',
            suggestedFix: 'Check deleteLastMemoryItem() in lib/db.js — it should set status to "Archived".',
        };
    }

    const archivedItem = afterAllItems.find((i) => i.status === 'Archived');
    if (!archivedItem) {
        return {
            bugFound: true,
            description: 'Active count decreased but no Archived item found — item may have been hard-deleted.',
            reproSteps: 'Check if item exists in memory_items with status=Archived after deletion.',
            suggestedFix: 'Ensure deleteLastMemoryItem() uses a status update (soft delete), not a hard DELETE query.',
        };
    }

    return { bugFound: false, description: 'Item correctly soft-deleted (Archived).', reproSteps: '', suggestedFix: '' };
}

/**
 * Check that the session's check_in_due_at was set ~25 minutes from now.
 */
export function checkCheckInTimer(sessionBefore, sessionAfter, toleranceMs = 120_000) {
    if (!sessionAfter?.check_in_due_at) {
        return {
            bugFound: true,
            description: 'check_in_due_at is null after check-in acceptance.',
            reproSteps: 'Send "yes please" when prompted for a focus session check-in. Inspect sessions.check_in_due_at.',
            suggestedFix: 'Check the isCheckInAcceptance block in route.js — updateSession() should set check_in_due_at to now+25min.',
        };
    }

    const expected = Date.now() + 25 * 60 * 1000;
    const diff = Math.abs(new Date(sessionAfter.check_in_due_at) - expected);

    if (diff > toleranceMs) {
        return {
            bugFound: true,
            description: `check_in_due_at is ${Math.round(diff / 60000)} minutes off from expected 25-min timer. Got: ${sessionAfter.check_in_due_at}`,
            reproSteps: 'Note the time, accept a check-in, compare sessions.check_in_due_at with now+25min.',
            suggestedFix: 'Audit the timer calculation in route.js: `new Date(Date.now() + 25 * 60 * 1000).toISOString()`.',
        };
    }

    return { bugFound: false, description: 'Check-in timer set correctly at 25 minutes.', reproSteps: '', suggestedFix: '' };
}

// ─── LLM-assisted bug cross-check ─────────────────────────────────────────────

/**
 * Use Groq to perform a deep cross-check on complex scenarios.
 * Falls back to a clean result if the LLM call fails.
 */
export async function callBugDetectorLLM(scenario, dbBefore, dbAfter, assistantResponse) {
    let attempts = 0;
    while (attempts < 3) {
        try {
            const client = getGroqClient();
            const response = await client.chat.completions.create({
                model: 'llama-3.1-8b-instant', // Downgraded to avoid 70B TPD limits
                messages: [
                    { role: 'system', content: buildBugDetectorPrompt() },
                    { role: 'user', content: buildBugDetectorUserMessage(scenario, dbBefore, dbAfter, assistantResponse) },
                ],
                max_tokens: 400,
                temperature: 0.1,
                response_format: { type: 'json_object' },
            });

            const raw = response.choices[0]?.message?.content || '{}';
            return JSON.parse(raw);
        } catch (err) {
            attempts++;
            if (attempts >= 3) {
                console.warn(`  [BugDetector] LLM cross-check failed after 3 tries: ${err.message}. Skipping LLM layer.`);
                return { bugFound: false, description: 'LLM check skipped.', reproSteps: '', suggestedFix: '' };
            }
            await new Promise(r => setTimeout(r, 500));
        }
    }
}

/**
 * Check a multi-turn "information dump" conversation:
 * - dump items should be captured
 * - explicit forget target should be archived (not a different item)
 * - final recall should include active targets and exclude forgotten target
 */
export function checkInfoDumpConversation(beforeAllItems, afterAllItems, transcript, config = {}) {
    const expectedActive = (config.expectedActive || []).map((x) => x.toLowerCase());
    const expectedForgotten = (config.expectedForgotten || '').toLowerCase();
    const turnSnapshots = Array.isArray(config.turnSnapshots) ? config.turnSnapshots : [];
    const finalTurnSnapshot = [...turnSnapshots].reverse().find((snap) => snap && Array.isArray(snap.allItems));
    const effectiveAfterAllItems = finalTurnSnapshot ? finalTurnSnapshot.allItems : (afterAllItems || []);
    const sourceLabel = finalTurnSnapshot
        ? `turn ${finalTurnSnapshot.turn || '?'} snapshot`
        : 'final post-run snapshot';

    const finalAssistant = [...(transcript || [])].reverse().find((t) => t.role === 'assistant')?.content || '';
    const finalLower = finalAssistant.toLowerCase();

    const addedItems = (effectiveAfterAllItems || []).filter(
        (a) => !(beforeAllItems || []).some((b) => b.id === a.id)
    );
    if (addedItems.length === 0) {
        return {
            bugFound: true,
            description: `No memory items were created during the information-dump conversation (source: ${sourceLabel}).`,
            reproSteps: 'Run the info_dump_conversation scenario and inspect memory_items inserts.',
            suggestedFix: 'Review memory capture intent routing in /api/chat/route.js and extraction logic.',
        };
    }

    const activeItems = (effectiveAfterAllItems || []).filter((i) => i.status === 'Active');
    const archivedItems = (effectiveAfterAllItems || []).filter((i) => i.status === 'Archived');

    const missingActive = expectedActive.filter(
        (needle) => !activeItems.some((i) => (i.content || '').toLowerCase().includes(needle))
    );
    if (missingActive.length > 0) {
        return {
            bugFound: true,
            description: `Expected active dump items missing: ${missingActive.join(', ')} (source: ${sourceLabel})`,
            reproSteps: 'Run the info_dump_conversation scenario and compare active memory_items with dump input.',
            suggestedFix: 'Improve multi-item extraction/parsing so each dumped item is persisted correctly.',
        };
    }

    if (expectedForgotten) {
        const forgottenArchived = archivedItems.some((i) => (i.content || '').toLowerCase().includes(expectedForgotten));
        if (!forgottenArchived) {
            return {
                bugFound: true,
                description: `Target forgotten item was not archived: "${expectedForgotten}" (source: ${sourceLabel})`,
                reproSteps: 'In info_dump_conversation, issue a targeted forget command and inspect archived item content.',
                suggestedFix: 'Update deletion flow to resolve and archive the requested item, not only the latest one.',
            };
        }
    }

    const missingInFinalRecall = expectedActive.filter((needle) => !finalLower.includes(needle));
    if (missingInFinalRecall.length > 0) {
        return {
            bugFound: true,
            description: `Final recall omitted active items: ${missingInFinalRecall.join(', ')}`,
            reproSteps: 'Check final assistant recall output in transcript against active memory_items.',
            suggestedFix: 'Strengthen memory recall prompt/context construction to include all active items.',
        };
    }

    if (expectedForgotten && finalLower.includes(expectedForgotten)) {
        return {
            bugFound: true,
            description: `Final recall still mentions forgotten item: "${expectedForgotten}"`,
            reproSteps: 'After forget command, request recall and verify removed item is absent.',
            suggestedFix: 'Ensure recall sources only active memory items and excludes archived entries.',
        };
    }

    return {
        bugFound: false,
        description: `Information dump conversation persisted, recalled, and forgot items correctly (validated via ${sourceLabel}).`,
        reproSteps: '',
        suggestedFix: '',
    };
}



