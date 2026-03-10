# Flowy Eval System

## 1. Overview

The Flowy Eval System is an automated quality assurance framework that evaluates FocusFlow's AI assistant responses across five dimensions:

1. **Tool Accuracy** -- Did the correct tool get called with the right arguments?
2. **Response Quality** -- Is the response empathetic, brief, actionable, and natural?
3. **Functional Correctness** -- Did the database state change as expected?
4. **Conversational Safety** -- Are forbidden words and shame language absent?
5. **Regression** -- Did previously passing scenarios start failing?

The system exists because FocusFlow is an ADHD productivity coach where tone and correctness are equally critical. A response that saves a reminder but uses shame language is just as broken as one that forgets to save the reminder entirely. The eval system catches both classes of failure automatically.

It runs 24 scenarios (8 core + 16 extended) against the live FocusFlow API, scoring each response with a weighted rubric and diffing database state before and after. Failures are grouped by root cause and mapped to specific files and line hints for rapid triage.

---

## 2. Architecture Diagram

```
+---------------------------------------------------------------------+
|                        EVAL RUNNER (runEvals.js)                     |
|                                                                      |
|  +--------------+    +---------------+    +------------------------+ |
|  |  Scenario    |--->|  API Client   |--->|  FocusFlow App         | |
|  |  Definition  |    |  (SSE POST)   |    |  (POST /api/chat)      | |
|  |              |    +---------------+    |                        | |
|  |  - seedMsg   |           |             |  +------------------+  | |
|  |  - setup()   |           |             |  | LangChain Agent  |  | |
|  |  - dbCheck() |           |             |  |  +------------+  |  | |
|  |  - expected  |           |             |  |  | Tool Loop  |  |  | |
|  +--------------+           |             |  |  | (3 iter)   |  |  | |
|         |                   |             |  |  +------------+  |  | |
|         |                   |             |  |        |         |  | |
|         v                   |             |  |  onEvalEvent()   |  | |
|  +--------------+           |             |  |        |         |  | |
|  |  DB State    |           |             |  |        v         |  | |
|  |  Snapshot    |           |             |  |  +------------+  |  | |
|  |  (before)    |           |             |  |  |eval_events |  |  | |
|  +--------------+           |             |  |  |   table    |  |  | |
|         |                   |             |  |  +------------+  |  | |
|         |                   |             |  +------------------+  | |
|         |                   |<------------+                        | |
|         |              SSE stream                                  | |
|         |              (full response)                             | |
|         v                   |                                      | |
|  +--------------+           |                                      | |
|  |  DB State    |           |                                      | |
|  |  Snapshot    |           |                                      | |
|  |  (after)     |           |                                      | |
|  +--------------+           |                                      | |
|         |                   |                                      | |
|    +----+----+              |                                      | |
|    v         v              v                                      | |
|  +-------+ +----------+  +--------------+                          | |
|  | Bug   | | Behavior |  |  Scenario    |                          | |
|  |Detect | | Evaluator|  |  Result      |                          | |
|  |(rules)| | (Groq    |  |  Aggregator  |                          | |
|  |       | |  LLM)    |  |              |                          | |
|  +---+---+ +----+-----+  +------+-------+                          | |
|      |          |               |                                   | |
|      +----------+---------------+                                   | |
|                 |                                                    | |
|                 v                                                    | |
|  +----------------------------------------------+                   | |
|  |            Reporter (reporter.js)              |                   | |
|  |  - Group failures by root cause                |                   | |
|  |  - Map to file:line hints                      |                   | |
|  |  - Generate triage summary                     |                   | |
|  +----------------------------------------------+                   | |
|                 |                                                    | |
|           +-----+------+                                            | |
|           v            v                                            | |
|     +----------+ +-----------+                                      | |
|     | Baseline | |  Reports  |                                      | |
|     |  Check   | | (MD/JSON) |                                      | |
|     +----------+ +-----------+                                      | |
+---------------------------------------------------------------------+
```

---

## 3. How a Single Eval Runs (Step-by-Step)

### Step 1: DB Setup

The runner calls `createTestUser('Eval Bot')` and `createTestSession(userId)` to provision a clean test user and session. Then it invokes the scenario's `setup()` function, which may seed specific memory items, messages, or reminders into the database via `dbClient.js`.

### Step 2: Snapshot DB State BEFORE

The runner calls `captureState()` which queries Supabase for:
- `getMemoryItems(userId)` -- active memory items
- `getAllMemoryItems(userId)` -- all items including archived
- `getSessionById(sessionId)` -- session record with `check_in_due_at`, `briefing_delivered`, etc.

This snapshot is stored as the `before` object.

### Step 3: Send User Message(s) via SSE

The runner iterates through the scenario's message(s) -- either a single `seedMessage` or an array of `multiTurnMessages`. For each turn:

1. `apiClient.sendMessage()` sends a `POST /api/chat` request with `{ message, sessionId, userId, timezone, clientHistory }`
2. The client reads the SSE stream, assembling `data:` lines into a full response string
3. Each `{ token }` JSON payload is concatenated until `[DONE]` is received
4. The turn is appended to both the transcript and `clientHistory` (for context continuity)

Multi-turn scenarios include a 300ms delay between turns to simulate natural pacing.

### Step 4: Snapshot DB State AFTER

The same `captureState()` is called again, producing the `after` object. This captures any database mutations caused by the app's tool calls during the chat.

### Step 5: Behavior Evaluator Scores the Response

The `behaviorEvaluator.evaluate()` function runs two phases:

1. **Fast-path checks** (no LLM needed):
   - Forbidden word scan against 10 regex patterns
   - Empty/too-short response check (<5 characters)
   - Either of these triggers an immediate FAIL with `qualityScore: 0`

2. **LLM evaluation** (Groq `llama-3.1-8b-instant`):
   - Sends the response, user message, scenario context, and scoring rubric to the LLM
   - Receives a JSON object with 5 dimension scores (0-10 each) and a weighted `qualityScore`
   - Verdict: PASS if `qualityScore >= 6` AND no forbidden words
   - Retries up to 3 times on API failure, then falls back to heuristic scoring

### Step 6: Bug Detector Diffs DB State

The scenario's `dbCheck()` function is called with `(dbOptions, userId, sessionId, seedData, before, after, response, transcript, {})`. This runs rule-based checks specific to the scenario type:

- `checkMemoryCapture()` -- verifies new rows were created with correct content
- `checkReminderCreation()` -- verifies `remind_at` is within +/-90s of expected
- `checkReminderReschedule()` -- verifies `remind_at` was updated correctly
- `checkMemoryRecall()` -- verifies response includes stored items
- `checkTaskDone()` -- verifies status changed to `Done`
- `checkMemoryDeleted()` -- verifies item was soft-deleted (status = `Archived`)
- `checkCheckInTimer()` -- verifies `check_in_due_at` is approximately `now + 25 min`
- `checkInfoDumpConversation()` -- verifies multi-turn persistence and targeted deletion

### Step 7: Result Aggregation

The final status is computed:
- `PASS` -- behavior eval passed AND no bugs found
- `FAIL` -- behavior eval failed OR bug detected
- `ERROR` -- an exception was thrown during the scenario

The result object includes: `id`, `name`, `tier`, `status`, `qualityScore`, `dimensions`, `flags`, `reason`, `suggestedFix`, `bug`, `transcript`, and `durationMs`.

### Step 8: Reporter Groups Failures

After all scenarios complete, `generateFailureReport()` categorizes each failure by root cause using regex pattern matching against the reason/suggestedFix text. Failures are grouped into categories (`tool`, `timing`, `db`, `prompt`, `unknown`) and mapped to specific source files and line hints.

---

## 4. Scoring Rubric

The Behavior Evaluator scores assistant responses across 5 dimensions, each rated 0-10:

| Dimension | Weight | What It Measures |
|-----------|--------|------------------|
| **empathy** | 25% | Acknowledges the user's emotional state warmly and supportively |
| **brevity** | 20% | Response is under ~100 words with no excessive bullet lists or over-explaining |
| **actionability** | 20% | Provides exactly one small, concrete next step (not a list of options) |
| **safety** | 20% | No forbidden words, no shame language, no urgency pressure |
| **naturalness** | 15% | Sounds like a supportive human friend, not a robotic task management app |

### Weighted Quality Score

```
qualityScore = (empathy * 0.25) + (brevity * 0.20) + (actionability * 0.20)
             + (safety * 0.20) + (naturalness * 0.15)
```

### Verdict Logic

```
PASS  if  qualityScore >= 6  AND  no forbidden words detected
FAIL  if  qualityScore < 6   OR   any forbidden word present
```

### Forbidden Words (Instant FAIL)

The following patterns trigger an immediate FAIL with `qualityScore: 0` before the LLM is even called:

- `lazy`, `easy`, `overdue`, `should have`, `you failed`, `just do it`
- `simple task`, `obviously`, `procrastinat*` (accusatory uses), `you need to`

### Heuristic Fallback

When the Groq API is unavailable (rate limits, outages), a regex-based heuristic estimates scores:
- Empathetic keywords detected -> empathy = 7, else 3
- Word count <= 100 -> brevity = 8; <= 130 -> 6; else 4
- Action keywords present -> actionability = 7, else 4
- Safety = 8 (forbidden words already checked in fast-path)
- Has substantive content -> naturalness = 7, else 2

---

## 5. Scenario Coverage Matrix

### Core Scenarios (8)

| ID | Name | Tier | Tool Tested | What It Checks |
|----|------|------|-------------|----------------|
| `memory_capture` | Memory Capture | core | save_memory | New item created with correct content |
| `reminder_creation` | Reminder Creation | core | save_memory | remind_at set +/-90s of expected |
| `reminder_reschedule` | Reminder Reschedule | core | reschedule_reminder | remind_at updated correctly |
| `memory_recall` | Memory Recall | core | -- (read-only) | Response lists stored items |
| `decomposition` | Task Decomposition | core | -- | One step + focus session offer |
| `task_complete` | Task Completion | core | complete_task | Status changed to Done |
| `check_in_acceptance` | Check-in Acceptance | core | set_checkin_timer | check_in_due_at approx now+25min |
| `info_dump_conversation` | Info Dump | core | save_memory, delete_memory | Multi-turn persistence + targeted delete |

### Extended Scenarios (16)

| ID | Name | Tier | Tool Tested | What It Checks |
|----|------|------|-------------|----------------|
| `memory_delete` | Memory Deletion | core | delete_memory | Status changed to Archived |
| `memory_capture_dedup` | Dedup | critical | save_memory | No duplicate items created |
| `no_tool_general_chat` | No Tool Chat | critical | -- (none expected) | No phantom saves on general conversation |
| `delete_memory_last` | Delete Last | critical | delete_memory | Last item archived correctly |
| `delete_memory_empty` | Delete Empty | standard | delete_memory | Graceful no-op when nothing to delete |
| `delete_memory_fuzzy` | Fuzzy Delete | standard | delete_memory | Correct item targeted by fuzzy match |
| `task_complete_empty` | Complete Empty | standard | complete_task | No crash on empty task state |
| `reschedule_no_reminder` | Reschedule None | critical | reschedule_reminder | Graceful error when no reminder exists |
| `emotional_burnout` | Burnout | critical | -- (none expected) | Pure empathy response, no phantom saves |
| `boundary_very_short` | Short Message | standard | -- | No crash on minimal input like "ok" |
| `reminder_2_hours` | 2-Hour Reminder | critical | save_memory | remind_at approx now+2h |
| `reminder_tomorrow_morning` | Tomorrow AM | standard | save_memory | remind_at approx next day 9:00 AM |
| `memory_recall_empty` | Recall Empty | standard | -- (read-only) | Graceful empty state acknowledgment |
| `checkin_custom_duration` | Custom Timer | standard | set_checkin_timer | 15-minute timer set correctly |
| `onboarding_step0` | Onboarding | standard | update_profile | Name acknowledgment in response |
| `multi_item_capture` | Multi-item | standard | save_memory | All 3 items captured in one turn |
| `emotional_frustration` | Frustration | critical | -- (none expected) | Empathy response, no phantom saves |

### Tier Distribution

| Tier | Count | Purpose |
|------|-------|---------|
| core | 9 | Fundamental features that must always work |
| critical | 7 | High-risk edge cases and safety scenarios |
| standard | 8 | Extended coverage for robustness |

---

## 6. Feedback Loop

The eval system supports two feedback loops depending on the type of failure detected.

### Fast Loop (Prompt/Tone Failures)

**Cycle time:** ~5 seconds per re-run

1. Evaluator detects a tone, empathy, or safety issue in the response
2. Developer reviews the `suggestedFix` in the triage report
3. Developer edits the system prompt in `lib/langchain/prompts.js`
4. Developer re-runs only the failing scenario: `npm run test:evals -- --scenario=<id>`
5. Repeat until the scenario passes

This loop is fast because prompt changes require no code logic changes -- just re-running the scenario against the updated prompt.

### Slow Loop (Tool/DB Failures)

**Cycle time:** varies (code change + restart + re-run)

1. Triage report groups failures by root cause category (tool, timing, db)
2. Report maps each group to a specific file and line hint (e.g., `lib/langchain/tools.js` -> `parseTime()`)
3. Developer navigates to the exact location and fixes the code
4. Developer restarts the dev server and re-runs the failing scenario
5. Once the scenario passes, developer runs the full regression check: `npm run test:evals:regression`
6. If no regressions, developer saves a new baseline: `npm run test:evals:save-baseline`

---

## 7. Baseline and Regression

### Saving a Baseline

After a clean run (all scenarios pass), save the current state as the regression baseline:

```bash
npm run test:evals:save-baseline
```

This creates `focusflow-ai-tests/baseline.json` containing:
- `runDate` -- ISO date of the clean run
- `passRate` -- fraction of scenarios that passed
- `avgQualityScore` -- mean quality score across all scored scenarios
- `scenarioResults` -- map of scenario ID to `{ status, qualityScore }`

The baseline is only saved when there are zero failures. If any scenario fails, the save is rejected with a warning.

### Checking for Regressions

```bash
npm run test:evals:regression
```

This compares the current run against `baseline.json` and flags two types of regressions:

1. **Status regression** -- A scenario that was `PASS` in the baseline is now `FAIL`
2. **Quality drop** -- A scenario's `qualityScore` dropped by more than 1.5 points

If any regression is detected, the process exits with code 1 (suitable for CI gating).

### CI Integration

In a CI pipeline, the regression check can gate merges:

```yaml
- run: npm run test:evals:regression
  # Exit code 1 blocks the merge if regressions are found
```

---

## 8. File Map

| File | Purpose |
|------|---------|
| `focusflow-ai-tests/runEvals.js` | Main eval orchestrator -- parses args, runs scenarios, writes reports |
| `focusflow-ai-tests/reporter.js` | Failure triage -- groups by root cause, maps to file:line hints |
| `focusflow-ai-tests/baseline.json` | Generated baseline for regression checks (not committed if clean) |
| `focusflow-ai-tests/tests/scenarios.js` | 9 core scenario definitions with setup/dbCheck functions |
| `focusflow-ai-tests/scenarios/extendedScenarios.js` | 16 extended scenario definitions |
| `focusflow-ai-tests/agents/behaviorEvaluator.js` | Scored LLM evaluator (5 dimensions, 0-10 each, weighted average) |
| `focusflow-ai-tests/agents/bugDetector.js` | Rule-based DB diff checker (memory, reminder, task, session checks) |
| `focusflow-ai-tests/agents/userSimulator.js` | LLM-based user message generator for dynamic test input |
| `focusflow-ai-tests/prompts/evaluatorPrompt.js` | System prompt for the behavior evaluator LLM call |
| `focusflow-ai-tests/prompts/bugPrompt.js` | System prompt for the bug detector LLM cross-check |
| `focusflow-ai-tests/prompts/simulatorPrompt.js` | System prompt for the user simulator agent |
| `focusflow-ai-tests/utils/apiClient.js` | SSE HTTP client -- sends POST to /api/chat, collects streamed response |
| `focusflow-ai-tests/utils/dbClient.js` | Direct Supabase queries for test setup, seeding, and state capture |
| `focusflow-ai-tests/utils/groqClient.js` | Groq SDK client factory (shared by evaluator + bug detector) |
| `focusflow-ai-tests/utils/reportGenerator.js` | Report formatting -- terminal output, Markdown, JSON, transcript logs |
| `supabase/migrations/003_eval_events.sql` | eval_events table migration (tool_call logging + latency tracking) |
| `lib/db.js` | App-side `saveEvalEvent()` + `getEvalEvents()` functions |
| `lib/langchain/streaming.js` | `onEvalEvent()` callback -- logs 4 event types during agent execution |

---

## 9. npm Scripts

```bash
# Run all 24 scenarios
npm run test:evals

# Run only critical-tier scenarios (7 scenarios, ~30s)
npm run test:evals:quick

# Compare current run against baseline.json (exit 1 on regression)
npm run test:evals:regression

# Save a clean run as the new baseline
npm run test:evals:save-baseline

# Run a single scenario by ID
npm run test:evals -- --scenario=memory_capture

# Run all scenarios in a specific tier
npm run test:evals -- --tier=core
npm run test:evals -- --tier=critical
npm run test:evals -- --tier=standard
```

### CLI Flags

| Flag | Effect |
|------|--------|
| `--scenario=<id>` | Run a single scenario by its ID |
| `--tier=<tier>` | Filter to scenarios of the given tier (core, critical, standard) |
| `--compare-baseline` | Check for regressions against `baseline.json` |
| `--save-baseline` | Save the current run as the new baseline (requires zero failures) |

---

## 10. Instrumentation (eval_events)

The `eval_events` table captures runtime telemetry during each chat request. Events are logged by the `onEvalEvent()` callback inside the LangChain agent loop in `lib/langchain/streaming.js`.

### Event Types

| Event Type | When It Fires | What It Records |
|------------|---------------|-----------------|
| `tool_call` | A tool executes successfully | `tool_name`, `tool_args` (JSONB), `tool_result`, `latency_ms`, `llm_iteration` |
| `tool_result` | (Reserved for future use) | Planned for structured tool output capture |
| `hallucination_blocked` | Guardrail blocks a phantom tool call | The attempted tool name and args that were rejected |
| `fallback` | Primary 70b model fails, 8b fallback used | Which model was substituted and why |
| `rate_limit` | Groq API returns HTTP 429 | Timestamp and retry metadata |

### Table Schema

```sql
CREATE TABLE eval_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID REFERENCES sessions(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  message_id    UUID REFERENCES messages(id) ON DELETE SET NULL,
  event_type    TEXT NOT NULL,  -- tool_call | tool_result | fallback | rate_limit | hallucination_blocked
  tool_name     TEXT,
  tool_args     JSONB,
  tool_result   TEXT,
  llm_iteration INT DEFAULT 1,
  latency_ms    INT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
```

### Indexes

- `eval_events_session_idx` -- efficient queries by session
- `eval_events_user_idx` -- efficient queries by user
- `eval_events_created_at_idx` -- reverse-chronological ordering

### Usage in Evals

The eval system does not query `eval_events` directly during test runs. Instead, the data serves as a post-hoc debugging aid. When a scenario fails due to a tool mismatch or hallucination, developers can query:

```sql
SELECT event_type, tool_name, tool_args, latency_ms
FROM eval_events
WHERE session_id = '<test-session-id>'
ORDER BY created_at;
```

This reveals exactly which tools were called (or blocked) during the failing request.
