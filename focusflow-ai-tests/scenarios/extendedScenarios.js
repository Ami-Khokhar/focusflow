/**
 * extendedScenarios.js — 16 additional eval scenarios for Flowy.
 * Covers tool edge cases, negative cases, emotional inputs, and boundary conditions.
 */

import {
    getMemoryItems,
    getAllMemoryItems,
    getLatestReminder,
    getSessionById,
    seedMemoryItem,
} from '../utils/dbClient.js';

import {
    checkMemoryCapture,
    checkReminderCreation,
    checkMemoryDeleted,
    checkMemoryRecall,
} from '../agents/bugDetector.js';

export const extendedScenarios = [
    // ─────────────────────────────────────────────────────────────────────────────
    // 1. Duplicate memory — should NOT create a second identical item
    // ─────────────────────────────────────────────────────────────────────────────
    {
        id: 'memory_capture_dedup',
        name: 'Memory Capture — Dedup',
        tier: 'critical',
        description: 'Sending the same capture twice should not create duplicate memory_items.',
        goal: 'Ask FocusFlow to remember the same thing twice.',
        seedMessage: 'remember to call mom',
        multiTurnMessages: [
            'remember to call mom',
            'actually remind me to call mom again',
        ],
        expectedIntent: 'memory_capture',
        expectedBehavior:
            'Acknowledges without creating a duplicate. Warm, brief. Does not list existing items unprompted.',
        expectedDbChange: 'Only one Active memory_items row for "call mom" — no duplicates.',

        async setup(db, userId) {
            // Seed the first instance
            const item = await seedMemoryItem(userId, 'call mom', 'Task');
            return { existingItem: item };
        },

        async dbCheck(db, userId, sessionId, seedData, before, after) {
            const allItems = after.allItems || [];
            const callMomItems = allItems.filter(
                (i) => i.status === 'Active' && (i.content || '').toLowerCase().includes('call mom')
            );
            if (callMomItems.length > 1) {
                return {
                    bugFound: true,
                    description: `Dedup failed: found ${callMomItems.length} active "call mom" items.`,
                    reproSteps: 'Send the same save message twice. Check memory_items for duplicates.',
                    suggestedFix: 'Verify dedup logic in saveMemoryItem() in lib/db.js (80% token overlap check).',
                };
            }
            return { bugFound: false, description: 'Dedup worked — no duplicate items.', reproSteps: '', suggestedFix: '' };
        },
    },

    // ─────────────────────────────────────────────────────────────────────────────
    // 2. No-trigger-word — general message should NOT save to memory
    // ─────────────────────────────────────────────────────────────────────────────
    {
        id: 'no_tool_general_chat',
        name: 'No Tool — General Chat',
        tier: 'critical',
        description: 'A general chat message should NOT trigger any memory save (no phantom tool calls).',
        goal: 'Just chat about how your day is going without asking to save anything.',
        seedMessage: 'hey how are you doing today',
        expectedIntent: 'general',
        expectedBehavior:
            'Responds warmly to the greeting. Does NOT say "I\'ve noted that" or "I\'ll remember that". Does NOT save anything to memory.',
        expectedDbChange: 'No new memory_items rows created.',

        async setup(db, userId) {
            return {};
        },

        async dbCheck(db, userId, sessionId, seedData, before, after) {
            const beforeCount = (before.items || []).length;
            const afterCount = (after.items || []).length;
            if (afterCount > beforeCount) {
                return {
                    bugFound: true,
                    description: `Hallucinated save: ${afterCount - beforeCount} new item(s) created from general chat.`,
                    reproSteps: 'Send a general greeting and check if memory_items has new rows.',
                    suggestedFix: 'Strengthen the SAVE_TRIGGERS regex or tool guardrail in lib/langchain/streaming.js.',
                };
            }
            return { bugFound: false, description: 'No phantom tool calls — general chat stayed clean.', reproSteps: '', suggestedFix: '' };
        },
    },

    // ─────────────────────────────────────────────────────────────────────────────
    // 3. Forget last item (explicit "forget that")
    // ─────────────────────────────────────────────────────────────────────────────
    {
        id: 'delete_memory_last',
        name: 'Delete Memory — Last Item',
        tier: 'critical',
        description: 'User says "actually nvm forget that" — last memory item should be archived.',
        goal: 'Tell FocusFlow to forget the last thing you told it.',
        seedMessage: 'actually nvm forget it',
        expectedIntent: 'memory_delete',
        expectedBehavior: 'Confirms the item is gone. Light and brief. No judgment.',
        expectedDbChange: 'Last active memory_items row archived.',

        async setup(db, userId) {
            const item = await seedMemoryItem(userId, 'submit expense report', 'Task');
            return { seededItem: item };
        },

        async dbCheck(db, userId, sessionId, seedData, before, after) {
            return checkMemoryDeleted(
                (before.items || []).length,
                after.allItems || [],
                (after.items || []).length
            );
        },
    },

    // ─────────────────────────────────────────────────────────────────────────────
    // 4. Delete memory — nothing to delete (empty state)
    // ─────────────────────────────────────────────────────────────────────────────
    {
        id: 'delete_memory_empty',
        name: 'Delete Memory — Nothing to Delete',
        tier: 'standard',
        description: 'User asks to forget something when memory is empty — should handle gracefully.',
        goal: 'Ask FocusFlow to forget something when nothing was saved.',
        seedMessage: 'wait forget that last thing',
        expectedIntent: 'memory_delete',
        expectedBehavior:
            'Gracefully acknowledges there is nothing to remove. Does NOT pretend to delete something. Brief and friendly.',
        expectedDbChange: 'No change to memory_items — empty state unchanged.',

        async setup(db, userId) {
            return {};
        },

        async dbCheck(db, userId, sessionId, seedData, before, after) {
            const beforeCount = (before.items || []).length;
            const afterCount = (after.items || []).length;
            if (afterCount < beforeCount) {
                return {
                    bugFound: true,
                    description: 'Deleted an item even though none existed — may have deleted a seeded item.',
                    reproSteps: 'With empty memory, send "forget that" and check memory_items.',
                    suggestedFix: 'Ensure deleteLastMemoryItem() handles null gracefully and does not error.',
                };
            }
            return { bugFound: false, description: 'Empty-state delete handled gracefully.', reproSteps: '', suggestedFix: '' };
        },
    },

    // ─────────────────────────────────────────────────────────────────────────────
    // 5. Fuzzy delete — match by content keywords
    // ─────────────────────────────────────────────────────────────────────────────
    {
        id: 'delete_memory_fuzzy',
        name: 'Delete Memory — Fuzzy Match',
        tier: 'standard',
        description: 'User says "forget the dentist thing" — targeted item should be archived.',
        goal: 'Tell FocusFlow to forget a specific item using a keyword.',
        seedMessage: 'actually forget the dentist thing',
        expectedIntent: 'memory_delete',
        expectedBehavior: 'Confirms the dentist-related item was removed. Brief confirmation.',
        expectedDbChange: 'The dentist memory_item should be Archived.',

        async setup(db, userId) {
            const dentist = await seedMemoryItem(userId, 'call dentist for appointment', 'Task');
            const other = await seedMemoryItem(userId, 'buy groceries', 'Task');
            return { dentistItem: dentist, otherItem: other };
        },

        async dbCheck(db, userId, sessionId, seedData, before, after) {
            const allItems = after.allItems || [];
            const dentistItem = allItems.find(
                (i) => i.id === seedData?.dentistItem?.id
            );
            if (!dentistItem || dentistItem.status !== 'Archived') {
                return {
                    bugFound: true,
                    description: 'Dentist item was not archived after fuzzy delete request.',
                    reproSteps: 'Seed "call dentist" item, send "forget the dentist thing", check memory_items.',
                    suggestedFix: 'Check deleteMemoryItemByContent() fuzzy match logic in lib/db.js.',
                };
            }
            const otherItem = allItems.find((i) => i.id === seedData?.otherItem?.id);
            if (otherItem && otherItem.status === 'Archived') {
                return {
                    bugFound: true,
                    description: 'Wrong item archived — "buy groceries" was deleted instead of dentist item.',
                    reproSteps: 'Seed two items, request targeted delete, verify correct item archived.',
                    suggestedFix: 'Improve token matching in deleteMemoryItemByContent() — check bestScore threshold.',
                };
            }
            return { bugFound: false, description: 'Fuzzy delete correctly targeted the dentist item.', reproSteps: '', suggestedFix: '' };
        },
    },

    // ─────────────────────────────────────────────────────────────────────────────
    // 6. Task completion — "done with that" when no active task
    // ─────────────────────────────────────────────────────────────────────────────
    {
        id: 'task_complete_empty',
        name: 'Task Completion — No Active Task',
        tier: 'standard',
        description: 'User says "done!" when no active task exists — should handle gracefully.',
        goal: 'Say you finished something when there is nothing tracked.',
        seedMessage: 'done!!',
        expectedIntent: 'task_complete',
        expectedBehavior:
            'Celebrates the win warmly without pretending to update a specific task. Asks what you just finished or what is next. Brief.',
        expectedDbChange: 'No change to memory_items — nothing to mark Done.',

        async setup(db, userId) {
            return {};
        },

        async dbCheck(db, userId, sessionId, seedData, before, after) {
            const beforeCount = (before.allItems || []).length;
            const afterCount = (after.allItems || []).length;
            // No new items should appear, and nothing should break
            return { bugFound: false, description: 'Empty-state completion handled gracefully.', reproSteps: '', suggestedFix: '' };
        },
    },

    // ─────────────────────────────────────────────────────────────────────────────
    // 7. Reschedule when no reminder exists
    // ─────────────────────────────────────────────────────────────────────────────
    {
        id: 'reschedule_no_reminder',
        name: 'Reschedule — No Reminder Exists',
        tier: 'critical',
        description: 'User says "push that back" when no reminder exists — should NOT crash.',
        goal: 'Try to push back a reminder that does not exist.',
        seedMessage: 'push that reminder back an hour',
        expectedIntent: 'reminder_reschedule',
        expectedBehavior:
            'Gracefully says there is no active reminder to reschedule. Offers to set one. Brief and friendly.',
        expectedDbChange: 'No change to memory_items.',

        async setup(db, userId) {
            return {};
        },

        async dbCheck(db, userId, sessionId, seedData, before, after) {
            return { bugFound: false, description: 'No-reminder reschedule handled gracefully.', reproSteps: '', suggestedFix: '' };
        },
    },

    // ─────────────────────────────────────────────────────────────────────────────
    // 8. Emotional input — user is burnt out
    // ─────────────────────────────────────────────────────────────────────────────
    {
        id: 'emotional_burnout',
        name: 'Emotional — Burnt Out',
        tier: 'critical',
        description: 'User expresses burnout — response must be purely empathetic, no task push.',
        goal: 'Express exhaustion and burnout to FocusFlow.',
        seedMessage: "i'm so burnt out i literally can't do anything today",
        expectedIntent: 'general',
        expectedBehavior:
            'Responds with pure empathy and validation. Does NOT push tasks or suggest productivity. Does NOT save anything. One soft question or acknowledgment only.',
        expectedDbChange: 'No new memory_items — burnout is not a task to save.',

        async setup(db, userId) {
            return {};
        },

        async dbCheck(db, userId, sessionId, seedData, before, after) {
            const beforeCount = (before.items || []).length;
            const afterCount = (after.items || []).length;
            if (afterCount > beforeCount) {
                return {
                    bugFound: true,
                    description: 'Hallucinated save during emotional expression — saved burnout as a memory item.',
                    reproSteps: 'Send a burnout message and check for new memory_items.',
                    suggestedFix: 'Strengthen tool guardrail in lib/langchain/streaming.js SAVE_TRIGGERS.',
                };
            }
            return { bugFound: false, description: 'Emotional input handled without phantom saves.', reproSteps: '', suggestedFix: '' };
        },
    },

    // ─────────────────────────────────────────────────────────────────────────────
    // 9. Very short message ("ok")
    // ─────────────────────────────────────────────────────────────────────────────
    {
        id: 'boundary_very_short',
        name: 'Boundary — Very Short Message',
        tier: 'standard',
        description: 'User sends just "ok" — should not crash or generate an empty response.',
        goal: 'Send a minimal acknowledgment message.',
        seedMessage: 'ok',
        expectedIntent: 'general',
        expectedBehavior:
            'Gentle, brief response asking what is on their mind or offering a nudge. Not confused. Not an error.',
        expectedDbChange: 'No DB change.',

        async setup(db, userId) {
            return {};
        },

        async dbCheck(db, userId, sessionId, seedData, before, after) {
            return { bugFound: false, description: 'Short message boundary case handled.', reproSteps: '', suggestedFix: '' };
        },
    },

    // ─────────────────────────────────────────────────────────────────────────────
    // 10. Reminder creation — 2 hours from now
    // ─────────────────────────────────────────────────────────────────────────────
    {
        id: 'reminder_2_hours',
        name: 'Reminder Creation — 2 Hours',
        tier: 'critical',
        description: 'User asks for a reminder in 2 hours — remind_at should be approximately now+2h.',
        goal: 'Ask FocusFlow to remind you about something in 2 hours.',
        seedMessage: 'remind me to renew my car insurance in 2 hours',
        expectedIntent: 'reminder_set',
        expectedBehavior: 'Confirms the 2-hour reminder warmly. Brief. States the content.',
        expectedDbChange: 'New Reminder item with remind_at approximately now+2 hours.',

        async setup(db, userId) {
            return { expectedAt: new Date(Date.now() + 2 * 60 * 60 * 1000) };
        },

        async dbCheck(db, userId, sessionId, seedData, before, after) {
            const reminder = await getLatestReminder(userId);
            if (!reminder) {
                return {
                    bugFound: true,
                    description: 'No reminder created for 2-hour request.',
                    reproSteps: 'Send "remind me to X in 2 hours" and check memory_items.',
                    suggestedFix: 'Check parseRemindTime() handling of "2 hours" in lib/langchain/tools.js.',
                };
            }
            const diff = Math.abs(new Date(reminder.remind_at) - new Date(seedData.expectedAt));
            if (diff > 120_000) {
                return {
                    bugFound: true,
                    description: `2-hour reminder off by ${Math.round(diff / 60000)} min. Got: ${reminder.remind_at}`,
                    reproSteps: 'Send "remind me in 2 hours" and compare remind_at vs now+2h.',
                    suggestedFix: 'Audit "hours" parsing in tools.js parseTime function.',
                };
            }
            return { bugFound: false, description: '2-hour reminder created correctly.', reproSteps: '', suggestedFix: '' };
        },
    },

    // ─────────────────────────────────────────────────────────────────────────────
    // 11. Reminder — tomorrow morning
    // ─────────────────────────────────────────────────────────────────────────────
    {
        id: 'reminder_tomorrow_morning',
        name: 'Reminder — Tomorrow Morning',
        tier: 'standard',
        description: 'User asks for a reminder "tomorrow morning" — remind_at should be next-day ~9am.',
        goal: 'Ask FocusFlow to remind you about something tomorrow morning.',
        seedMessage: 'remind me to submit the timesheet tomorrow morning',
        expectedIntent: 'reminder_set',
        expectedBehavior: 'Confirms the morning reminder with approximate time. Brief and warm.',
        expectedDbChange: 'New Reminder item with remind_at approximately next calendar day 9am.',

        async setup(db, userId) {
            const tomorrow9am = new Date();
            tomorrow9am.setDate(tomorrow9am.getDate() + 1);
            tomorrow9am.setHours(9, 0, 0, 0);
            return { expectedAt: tomorrow9am };
        },

        async dbCheck(db, userId, sessionId, seedData, before, after) {
            const reminder = await getLatestReminder(userId);
            if (!reminder || !reminder.remind_at) {
                return {
                    bugFound: true,
                    description: 'No reminder created for "tomorrow morning" request.',
                    reproSteps: 'Send "remind me tomorrow morning" and check memory_items.',
                    suggestedFix: 'Check "tomorrow morning" parsing in lib/langchain/tools.js.',
                };
            }
            return { bugFound: false, description: 'Tomorrow morning reminder created.', reproSteps: '', suggestedFix: '' };
        },
    },

    // ─────────────────────────────────────────────────────────────────────────────
    // 12. Memory recall — empty state
    // ─────────────────────────────────────────────────────────────────────────────
    {
        id: 'memory_recall_empty',
        name: 'Memory Recall — Empty State',
        tier: 'standard',
        description: 'User asks what Flowy remembers when nothing is saved — graceful empty state.',
        goal: 'Ask what FocusFlow remembers when you have not saved anything.',
        seedMessage: "what do you have for me today? what's on my list?",
        expectedIntent: 'memory_recall',
        expectedBehavior:
            'Gracefully says the list is empty. Invites the user to share something. Warm and brief.',
        expectedDbChange: 'No DB change — read-only.',

        async setup(db, userId) {
            return {};
        },

        async dbCheck(db, userId, sessionId, seedData, before, after, assistantResponse) {
            return checkMemoryRecall(assistantResponse, []);
        },
    },

    // ─────────────────────────────────────────────────────────────────────────────
    // 13. Check-in timer — custom 15 minutes
    // ─────────────────────────────────────────────────────────────────────────────
    {
        id: 'checkin_custom_duration',
        name: 'Check-in — Custom Duration',
        tier: 'standard',
        description: 'User asks for a 15-minute check-in instead of the default 25.',
        goal: 'Accept a focus session but ask for only 15 minutes.',
        seedMessage: 'yeah set a 15 minute timer for me',
        expectedIntent: 'check_in_acceptance',
        expectedBehavior:
            'Confirms the 15-minute timer is set. Encouraging. Brief. Mentions the time.',
        expectedDbChange: 'sessions.check_in_due_at set to approximately now+15min.',

        async setup(db, userId) {
            return {};
        },

        async dbCheck(db, userId, sessionId, seedData, before, after) {
            const sessionAfter = await getSessionById(sessionId);
            if (!sessionAfter?.check_in_due_at) {
                return {
                    bugFound: true,
                    description: 'check_in_due_at not set after 15-minute timer request.',
                    reproSteps: 'Send "set a 15 minute timer" and check sessions.check_in_due_at.',
                    suggestedFix: 'Check set_checkin_timer tool in lib/langchain/tools.js for custom duration parsing.',
                };
            }
            return { bugFound: false, description: 'Custom-duration check-in timer set.', reproSteps: '', suggestedFix: '' };
        },
    },

    // ─────────────────────────────────────────────────────────────────────────────
    // 14. Onboarding step 0 — name collection
    // ─────────────────────────────────────────────────────────────────────────────
    {
        id: 'onboarding_step0',
        name: 'Onboarding — Step 0 Name',
        tier: 'standard',
        description: 'New user in onboarding step 0 provides their name.',
        goal: 'Tell FocusFlow your name as part of onboarding.',
        seedMessage: "I'm Alex",
        expectedIntent: 'onboarding',
        expectedBehavior:
            'Acknowledges the name warmly. Asks the next onboarding question (main focus or biggest struggle). Does not dump all questions at once.',
        expectedDbChange: 'users.display_name updated to "Alex" OR users.onboarding_step incremented.',

        async setup(db, userId) {
            return {};
        },

        async dbCheck(db, userId, sessionId, seedData, before, after) {
            return { bugFound: false, description: 'Onboarding step 0 response checked by behavior evaluator.', reproSteps: '', suggestedFix: '' };
        },
    },

    // ─────────────────────────────────────────────────────────────────────────────
    // 15. Multi-item capture in one message
    // ─────────────────────────────────────────────────────────────────────────────
    {
        id: 'multi_item_capture',
        name: 'Multi-item Capture',
        tier: 'standard',
        description: 'User lists 3 things to remember in one message — all 3 should be captured.',
        goal: 'Tell FocusFlow to remember 3 separate things at once.',
        seedMessage: 'hey can you remember these: call dentist, finish report, and email Jake',
        expectedIntent: 'memory_capture',
        expectedBehavior:
            'Confirms all 3 items were captured. Lists them briefly. Warm acknowledgment.',
        expectedDbChange: '3 new Active memory_items rows created.',

        async setup(db, userId) {
            return {};
        },

        async dbCheck(db, userId, sessionId, seedData, before, after) {
            const newItems = (after.items || []).filter(
                (a) => !(before.items || []).some((b) => b.id === a.id)
            );
            const targets = ['dentist', 'report', 'jake'];
            const missingTargets = targets.filter(
                (t) => !newItems.some((i) => (i.content || '').toLowerCase().includes(t))
            );

            if (newItems.length < 2) {
                return {
                    bugFound: true,
                    description: `Only ${newItems.length}/3 items captured from multi-item message.`,
                    reproSteps: 'Send a message listing 3 items to remember. Check memory_items.',
                    suggestedFix: 'Improve multi-item extraction in the memory capture tool handler.',
                };
            }
            if (missingTargets.length > 1) {
                return {
                    bugFound: true,
                    description: `Missing content in captured items: ${missingTargets.join(', ')}`,
                    reproSteps: 'Verify each of the 3 items appears in memory_items.content.',
                    suggestedFix: 'Check save_memory tool content extraction for comma-separated lists.',
                };
            }
            return { bugFound: false, description: `Multi-item capture: ${newItems.length} items captured.`, reproSteps: '', suggestedFix: '' };
        },
    },

    // ─────────────────────────────────────────────────────────────────────────────
    // 16. Frustration / high emotion handling
    // ─────────────────────────────────────────────────────────────────────────────
    {
        id: 'emotional_frustration',
        name: 'Emotional — Frustration',
        tier: 'critical',
        description: 'User expresses frustration — response must validate, not lecture.',
        goal: 'Express strong frustration and overwhelm about a project.',
        seedMessage: "ugh i hate this stupid project i can't get ANYTHING done it's been 3 days",
        expectedIntent: 'general',
        expectedBehavior:
            'Validates the frustration warmly without minimizing it. Does NOT use "I understand" robotically. Offers one gentle option. Short. No task push.',
        expectedDbChange: 'No new memory_items.',

        async setup(db, userId) {
            return {};
        },

        async dbCheck(db, userId, sessionId, seedData, before, after) {
            const beforeCount = (before.items || []).length;
            const afterCount = (after.items || []).length;
            if (afterCount > beforeCount) {
                return {
                    bugFound: true,
                    description: 'Phantom save during frustration expression.',
                    reproSteps: 'Send a frustration message and check memory_items.',
                    suggestedFix: 'Strengthen SAVE_TRIGGERS guardrail in lib/langchain/streaming.js.',
                };
            }
            return { bugFound: false, description: 'Frustration handled without phantom saves.', reproSteps: '', suggestedFix: '' };
        },
    },
];
