/**
 * scenarios.js — Deterministic and conversation test scenarios for FocusFlow.
 *
 * Each scenario defines:
 *   name             — display name for the report
 *   description      — one-line summary
 *   goal             — context for the User Simulator
 *   seedMessage      — the exact user message to send (deterministic mode)
 *   expectedIntent   — the intent FocusFlow should detect
 *   expectedBehavior — what the BehaviorEvaluator checks for
 *   expectedDbChange — description for the BugDetector LLM
 *   setup            — async fn(dbClient, userId, sessionId) → seedData
 *   dbCheck          — fn(dbClient, userId, sessionId, seedData, before, after) → bugReport
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
    checkReminderReschedule,
    checkMemoryRecall,
    checkTaskDone,
    checkMemoryDeleted,
    checkCheckInTimer,
    checkInfoDumpConversation,
} from '../agents/bugDetector.js';

export const scenarios = [
    // ─────────────────────────────────────────────────────────────────────────────
    // 1. Memory Capture
    // ─────────────────────────────────────────────────────────────────────────────
    {
        id: 'memory_capture',
        name: 'Memory Capture',
        description: 'User asks to remember a task — a new memory_items row should be created.',
        goal: 'Ask FocusFlow to remember something important like calling mom.',
        seedMessage: 'remember to call mom',
        expectedIntent: 'memory_capture',
        expectedBehavior:
            'Acknowledges the captured item warmly. Confirms "call mom" was saved. Does not list next steps unprompted.',
        expectedDbChange: 'A new Active memory_items row should appear with content containing "call mom".',

        async setup(db, userId) {
            // No special setup needed
            return {};
        },

        async dbCheck(db, userId, sessionId, seedData, before, after) {
            return checkMemoryCapture(before.items, after.items, 'call mom');
        },
    },

    // ─────────────────────────────────────────────────────────────────────────────
    // 2. Reminder Creation
    // ─────────────────────────────────────────────────────────────────────────────
    {
        id: 'reminder_creation',
        name: 'Reminder Creation',
        description: 'User asks for a timed reminder — remind_at should be set ~10 minutes from now.',
        goal: 'Ask FocusFlow to remind you to send an email in 10 minutes.',
        seedMessage: 'remind me to send the email in 10 minutes',
        expectedIntent: 'reminder_set',
        expectedBehavior:
            'Confirms the reminder for "send the email" with the time. Warm, brief confirmation. No lecture.',
        expectedDbChange: 'A new Reminder item with remind_at ≈ now+10 minutes.',

        async setup(db, userId) {
            return { expectedAt: new Date(Date.now() + 10 * 60 * 1000) };
        },

        async dbCheck(db, userId, sessionId, seedData, before, after) {
            const reminder = await getLatestReminder(userId);
            return checkReminderCreation(reminder, seedData.expectedAt, 90_000);
        },
    },

    // ─────────────────────────────────────────────────────────────────────────────
    // 3. Reminder Reschedule
    // ─────────────────────────────────────────────────────────────────────────────
    {
        id: 'reminder_reschedule',
        name: 'Reminder Reschedule',
        description: 'User pushes a reminder back 30 minutes — remind_at should update.',
        goal: 'Tell FocusFlow to push the last reminder back by 30 minutes.',
        seedMessage: 'actually push that back 30 minutes',
        expectedIntent: 'reminder_reschedule',
        expectedBehavior:
            'Warm, short confirmation that the reminder was pushed back. Mentioning what the reminder is about is fine. Does NOT need a focus session offer, coaching suggestion, or to mark anything in memory. A sentence like "Got it — I pushed that reminder to [time] to [content]" is a perfect PASS.',
        expectedDbChange: 'Existing Reminder item remind_at updated to now+30 minutes.',

        async setup(db, userId) {
            // Seed an existing reminder with remind_at = now+10min
            const oldRemindAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
            const reminder = await seedMemoryItem(userId, 'email Rahul', 'Reminder', oldRemindAt);
            return { seededReminder: reminder, expectedAt: new Date(Date.now() + 30 * 60 * 1000) };
        },

        async dbCheck(db, userId, sessionId, seedData, before, after) {
            const afterReminder = await getLatestReminder(userId);
            return checkReminderReschedule(
                seedData.seededReminder,
                afterReminder,
                seedData.expectedAt,
                90_000
            );
        },
    },

    // ─────────────────────────────────────────────────────────────────────────────
    // 4. Memory Recall
    // ─────────────────────────────────────────────────────────────────────────────
    {
        id: 'memory_recall',
        name: 'Memory Recall',
        description: 'User asks what FocusFlow remembers — response should list stored items.',
        goal: 'Ask FocusFlow what it remembers about your tasks.',
        seedMessage: 'wait what was I supposed to do again? what do you remember?',
        expectedIntent: 'memory_recall',
        expectedBehavior:
            'Lists stored items warmly with bullet points. Optionally offers to help choose one to start. Does NOT need a focus session. Brief and friendly.',
        expectedDbChange: 'No DB change expected — this is a read-only operation.',

        async setup(db, userId) {
            // Seed two items so we have something to recall
            const item1 = await seedMemoryItem(userId, 'finish the project report', 'Task');
            const item2 = await seedMemoryItem(userId, 'call dentist', 'Task');
            return { seededItems: [item1, item2] };
        },

        async dbCheck(db, userId, sessionId, seedData, before, after, assistantResponse) {
            return checkMemoryRecall(assistantResponse, seedData.seededItems);
        },
    },

    // ─────────────────────────────────────────────────────────────────────────────
    // 5. Decomposition
    // ─────────────────────────────────────────────────────────────────────────────
    {
        id: 'decomposition',
        name: 'Task Decomposition',
        description: 'User feels overwhelmed — assistant should give ONE small step and offer a focus session.',
        goal: 'Express feeling overwhelmed by a big project and ask for help.',
        seedMessage: "I'm so overwhelmed with this project, I don't even know where to start",
        expectedIntent: 'decomposition',
        expectedBehavior:
            'Validates the overwhelm with empathy. Gives exactly ONE small, concrete first step. Offers a 25-minute focus session check-in. No lists of bullet points.',
        expectedDbChange: 'No DB change expected for decomposition itself.',

        async setup(db, userId) {
            return {};
        },

        async dbCheck(db, userId, sessionId, seedData, before, after, assistantResponse) {
            // Check LLM response quality rather than DB state
            const hasOneStep = /first step|start by|just/i.test(assistantResponse) &&
                !/\n\d\.|^\- /m.test(assistantResponse); // no numbered lists
            const offersFocus = /25|focus|check.?in|timer/i.test(assistantResponse);

            if (!offersFocus) {
                return {
                    bugFound: true,
                    description: 'Decomposition response did not offer a focus session / check-in timer.',
                    reproSteps: 'Send an overwhelmed message and check if response mentions "25 minutes" or "focus" or "check in".',
                    suggestedFix: 'Update the decomposition system prompt in lib/prompts.js to always offer a 25-minute focus session.',
                };
            }

            return { bugFound: false, description: 'Decomposition responded with step and focus offer.', reproSteps: '', suggestedFix: '' };
        },
    },

    // ─────────────────────────────────────────────────────────────────────────────
    // 6. Task Completion
    // ─────────────────────────────────────────────────────────────────────────────
    {
        id: 'task_complete',
        name: 'Task Completion',
        description: 'User says "done!" — the active task should be marked Done in memory_items.',
        goal: 'Tell FocusFlow you finished the task.',
        seedMessage: 'done!!',
        expectedIntent: 'task_complete',
        expectedBehavior:
            'Celebrates completion enthusiastically. A short response like "Nice work finishing that! What\'s next?" is a perfect PASS. Does NOT need to mention the task by name, mark it as done explicitly, or offer a focus session. Short and energizing is ideal.',
        expectedDbChange: 'An existing memory_items row should have status updated to "Done".',

        async setup(db, userId) {
            const task = await seedMemoryItem(userId, 'finish the project report', 'Task');
            return { seededTask: task };
        },

        async dbCheck(db, userId, sessionId, seedData, before, after) {
            return checkTaskDone(before.items, after.allItems, 'project report');
        },
    },

    // ─────────────────────────────────────────────────────────────────────────────
    // 7. Check-in Acceptance
    // ─────────────────────────────────────────────────────────────────────────────
    {
        id: 'check_in_acceptance',
        name: 'Check-in Acceptance',
        description: 'User accepts a focus check-in — session.check_in_due_at should be set ~25min out.',
        goal: 'Accept the offer of a 25-minute focus session timer.',
        seedMessage: 'yes please set that timer',
        expectedIntent: 'check_in_acceptance',
        expectedBehavior:
            'Confirms focus mode is on or encourages the user to start. Mentions the timer (does NOT have to explicitly say 25 minutes). Encouraging and brief. A sentence like "Got it! I\'ll be quiet until then. Go ahead and get started" is a perfect PASS.',
        expectedDbChange: 'sessions.check_in_due_at set to now + 25 minutes.',

        async setup(db, userId) {
            // Check-in acceptance requires the assistant to have JUST offered a check-in
            // We need to seed a message in the session history simulating this offer.
            const session = await db.getSessionById(await db.createTestSession(userId).then(s => s.id));
            await db.seedMessage(session.id, 'assistant', 'Want me to check in with you in 25 minutes?');
            return { seededSessionId: session.id };
        },

        async dbCheck(db, userId, sessionId, seedData, before, after) {
            const sessionAfter = await getSessionById(sessionId);
            return checkCheckInTimer(before.session, sessionAfter);
        },
    },

    // ─────────────────────────────────────────────────────────────────────────────
    // 8. Reminder Deletion
    // ─────────────────────────────────────────────────────────────────────────────
    {
        id: 'info_dump_conversation',
        name: 'Info Dump Conversation',
        description: 'Multi-turn dump/recall/forget flow should persist multiple items and forget the targeted one.',
        goal: 'Simulate a user dumping multiple items, recalling them, forgetting one, and recalling again.',
        seedMessage: 'remember these things',
        multiTurnMessages: [
            'remember these: call bank, submit rent receipt, ask Rahul about API caching',
            'also remind me to renew car insurance in 2 hours',
            'what do you remember right now?',
            'forget the API caching item',
            'what do you remember now?'
        ],
        expectedIntent: 'memory_capture',
        expectedBehavior: 'Maintains continuity across turns and accurately reflects memory state changes.',
        expectedDbChange: 'Multiple items captured, targeted item archived, and final recall excludes forgotten item.',
        disableBehaviorEval: true,
        behaviorEvalReason: 'Conversation-level scenario uses deterministic DB/transcript assertions instead of single-turn style evaluation.',

        async setup(db, userId) {
            return {};
        },

        async dbCheck(db, userId, sessionId, seedData, before, after, assistantResponse, transcript, runtime = {}) {
            return checkInfoDumpConversation(before.allItems, after.allItems, transcript, {
                expectedActive: ['call bank', 'submit rent receipt', 'renew car insurance'],
                expectedForgotten: 'api caching',
                turnSnapshots: runtime.turnSnapshots || [],
            });
        },
    },

    {
        id: 'memory_delete',
        name: 'Memory Deletion',
        description: 'User says "forget that" — the last memory item should be soft-deleted (Archived).',
        goal: 'Tell FocusFlow to forget the last thing it remembered.',
        seedMessage: 'forget that actually',
        expectedIntent: 'memory_delete',
        expectedBehavior:
            'Confirms the item has been removed. Light and reassuring. No drama about deleting.',
        expectedDbChange: 'Last active memory_items row should have status = "Archived".',

        async setup(db, userId) {
            const item = await seedMemoryItem(userId, 'call dentist tomorrow', 'Task');
            return { seededItem: item };
        },

        async dbCheck(db, userId, sessionId, seedData, before, after) {
            return checkMemoryDeleted(
                before.items.length,
                after.allItems,
                after.items.length
            );
        },
    },
];


