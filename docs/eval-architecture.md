# Flowy Eval System -- Architecture Diagrams

This document provides visual architecture diagrams for the Flowy Eval System. For detailed explanations of each component, see [eval-system.md](./eval-system.md).

---

## 1. System Overview

The top-level architecture showing all components and their relationships.

```
+=====================================================================+
|                       FLOWY EVAL SYSTEM                              |
+=====================================================================+
|                                                                      |
|  ORCHESTRATION LAYER                                                 |
|  +----------------------------------------------------------------+  |
|  |  runEvals.js                                                    |  |
|  |                                                                 |  |
|  |  - Parse CLI args (--scenario, --tier, --compare-baseline)      |  |
|  |  - Load core (9) + extended (16) scenarios                      |  |
|  |  - Create test user + session via dbClient                      |  |
|  |  - Run scenarios sequentially                                   |  |
|  |  - Aggregate results + write reports                            |  |
|  |  - Baseline save / regression check                             |  |
|  +----------------------------------------------------------------+  |
|         |              |               |              |              |
|         v              v               v              v              |
|  +-----------+  +------------+  +------------+  +------------+       |
|  | scenarios |  | apiClient  |  | dbClient   |  | reporter   |       |
|  | .js       |  | .js        |  | .js        |  | .js        |       |
|  |           |  |            |  |            |  |            |       |
|  | 25 test   |  | SSE POST   |  | Supabase   |  | Root cause |       |
|  | scenarios |  | to /chat   |  | queries    |  | grouping   |       |
|  +-----------+  +------------+  +------------+  +------------+       |
|                        |               |                             |
|  EVALUATION LAYER      |               |                             |
|  +---------------------+---------------+---------------------------+ |
|  |                     v               v                            | |
|  |  +------------------+--+  +--------+--------+                   | |
|  |  | behaviorEvaluator   |  | bugDetector      |                   | |
|  |  |                     |  |                   |                   | |
|  |  | 1. Forbidden word   |  | 1. checkMemory   |                   | |
|  |  |    scan (fast)      |  |    Capture()      |                   | |
|  |  | 2. Groq LLM eval   |  | 2. checkReminder |                   | |
|  |  |    (5 dimensions)   |  |    Creation()     |                   | |
|  |  | 3. Heuristic        |  | 3. checkTask     |                   | |
|  |  |    fallback         |  |    Done()         |                   | |
|  |  +----------+----------+  | 4. checkMemory   |                   | |
|  |             |             |    Deleted()      |                   | |
|  |             |             | 5. checkCheckIn  |                   | |
|  |             |             |    Timer()        |                   | |
|  |             |             | 6. LLM cross-    |                   | |
|  |             |             |    check (opt.)   |                   | |
|  |             |             +--------+----------+                   | |
|  |             |                      |                              | |
|  |             +----------+-----------+                              | |
|  |                        |                                          | |
|  |                        v                                          | |
|  |               +--------+--------+                                 | |
|  |               | reportGenerator |                                 | |
|  |               |                 |                                 | |
|  |               | - Terminal      |                                 | |
|  |               | - Markdown      |                                 | |
|  |               | - JSON          |                                 | |
|  |               | - Transcript    |                                 | |
|  |               +-----------------+                                 | |
|  +-------------------------------------------------------------------+ |
|                                                                      |
|  PROMPT LAYER                                                        |
|  +----------------------------------------------------------------+  |
|  | evaluatorPrompt.js | bugPrompt.js | simulatorPrompt.js          |  |
|  +----------------------------------------------------------------+  |
|                                                                      |
|  EXTERNAL DEPENDENCIES                                               |
|  +----------------+  +------------------+  +---------------------+   |
|  | FocusFlow App  |  | Groq API         |  | Supabase            |   |
|  | (localhost:3000)|  | (llama-3.1-8b)   |  | (PostgreSQL)        |   |
|  | POST /api/chat |  | Eval scoring     |  | memory_items,       |   |
|  | SSE streaming  |  | Bug cross-check  |  | sessions, messages, |   |
|  +----------------+  +------------------+  | eval_events         |   |
|                                            +---------------------+   |
+======================================================================+
```

---

## 2. Single Scenario Execution Flow

Sequence diagram showing the full lifecycle of one eval scenario.

```
Test Runner       API Client      FocusFlow App      Groq API       Supabase
    |                  |                |                |               |
    |  setup()         |                |                |               |
    +------------------+----------------+----------------+------------->|
    |                  |                |                |    seed data  |
    |                  |                |                |               |
    |  captureState()  |                |                |               |
    |  BEFORE          |                |                |               |
    +------------------+----------------+----------------+------------->|
    |                  |                |                |  query state  |
    |<-----------------+----------------+----------------+--------------+
    |  { items, allItems, session }     |                |               |
    |                  |                |                |               |
    |  sendMessage()   |                |                |               |
    +----------------->|  POST /chat    |                |               |
    |                  +--------------->|                |               |
    |                  |                |  classify      |               |
    |                  |                +--------------->|               |
    |                  |                |<---------------+               |
    |                  |                |  intent JSON   |               |
    |                  |                |                |               |
    |                  |                |  tool call     |               |
    |                  |                +----------------+-------------->|
    |                  |                |                |  save/update  |
    |                  |                |                |               |
    |                  |                |  onEvalEvent() |               |
    |                  |                +----------------+-------------->|
    |                  |                |                |  eval_events  |
    |                  |                |                |               |
    |                  |                |  stream resp.  |               |
    |                  |                +--------------->|               |
    |                  |   SSE tokens   |<---------------+               |
    |                  |<---------------+   tokens       |               |
    |  fullResponse    |                |                |               |
    |<-----------------+                |                |               |
    |                  |                |                |               |
    |  captureState()  |                |                |               |
    |  AFTER           |                |                |               |
    +------------------+----------------+----------------+------------->|
    |                  |                |                |  query state  |
    |<-----------------+----------------+----------------+--------------+
    |  { items, allItems, session }     |                |               |
    |                  |                |                |               |
    |  evaluate()      |                |                |               |
    |  [Behavior Evaluator]             |                |               |
    |  1. Forbidden word check          |                |               |
    |  2. LLM scoring (if needed)       |                |               |
    +-----------------------------------+--------------->|               |
    |                  |                |                |  LLM eval     |
    |<----------------------------------+----------------+               |
    |  { verdict, qualityScore,         |   score JSON   |               |
    |    dimensions, flags }            |                |               |
    |                  |                |                |               |
    |  dbCheck()       |                |                |               |
    |  [Bug Detector]  |                |                |               |
    |  Rule-based DB diff               |                |               |
    |  (before vs after)                |                |               |
    |                  |                |                |               |
    |  aggregate()     |                |                |               |
    |  PASS / FAIL / ERROR              |                |               |
    |                  |                |                |               |
    v                  v                v                v               v
```

---

## 3. Feedback Loop Diagram

How eval results drive iterative fixes through two distinct loops.

```
                    +----------------------------------+
                    |       npm run test:evals          |
                    +----------------+-----------------+
                                     |
                                     v
                    +----------------------------------+
                    |      Run All 24 Scenarios         |
                    +----------------+-----------------+
                                     |
                    +----------------v-----------------+
                    |        Failures Found?            |
                    +------+-------------------+-------+
                           | YES               | NO
                           v                   v
              +----------------+       +------------------+
              |  Triage Report |       | All passed --    |
              |  (reporter.js) |       | save baseline    |
              +---+--------+---+       | --save-baseline  |
                  |        |           +------------------+
         +--------+        +--------+
         v                          v
  +--------------+         +---------------+
  | Prompt/Tone  |         | Tool/DB       |
  | Failure      |         | Failure       |
  |              |         |               |
  | Root cause:  |         | Root cause:   |
  |  prompts.js  |         |  tools.js     |
  |              |         |  streaming.js |
  | FAST LOOP    |         |  db.js        |
  | ~5s rerun    |         |               |
  |              |         | SLOW LOOP     |
  | 1. Read      |         | code change + |
  |    suggestion|         | server restart|
  | 2. Edit      |         |               |
  |    prompt    |         | 1. Read hint  |
  | 3. Rerun     |         | 2. Fix code   |
  |    scenario  |         | 3. Restart    |
  +--------------+         | 4. Rerun      |
         |                 +-------+-------+
         |                         |
         +------------+------------+
                      |
                      v
              +-------------------+
              |  Re-run failing   |
              |  scenario only    |
              |                   |
              |  npm run test:evals|
              |  -- --scenario=ID |
              +--------+----------+
                       |
                       v
              +-------------------+
              |  Scenario passes? |
              +---+----------+----+
                  | YES      | NO
                  v          +---> (loop back to fix)
              +-------------------+
              |  Run full         |
              |  regression check |
              |                   |
              |  npm run test:evals|
              |   :regression     |
              +--------+----------+
                       |
              +--------v----------+
              |  Regressions?     |
              +---+----------+----+
                  | NO       | YES
                  v          +---> (fix regressions first)
              +-------------------+
              |  Update baseline  |
              |                   |
              |  npm run test:evals|
              |   :save-baseline  |
              +-------------------+
```

---

## 4. Scoring Pipeline Diagram

How an assistant response flows through evaluation to produce a PASS/FAIL verdict.

```
  Assistant Response
         |
         v
  +----------------------+
  |  Fast-Path Checks    |
  |  (no LLM needed)     |
  |                      |
  |  Forbidden word?     +---> YES ---> FAIL (qualityScore: 0)
  |   - lazy             |             flags: ["Forbidden word: ..."]
  |   - easy             |
  |   - overdue          |
  |   - should have      |
  |   - you failed       |
  |   - just do it       |
  |   - simple task      |
  |   - obviously        |
  |   - procrastinat*    |
  |   - you need to      |
  |                      |
  |  Empty response?     +---> YES ---> FAIL (qualityScore: 0)
  |  (< 5 characters)    |             reason: "empty or nearly empty"
  +----------+-----------+
             | pass
             v
  +----------------------------------+
  |  Groq LLM Evaluator             |
  |  Model: llama-3.1-8b-instant     |
  |  Temp: 0.2 (deterministic)       |
  |  Max retries: 3                  |
  |                                  |
  |  Input:                          |
  |  - System: scoring rubric        |
  |  - User: scenario context +     |
  |    user message + response       |
  |                                  |
  |  Output: JSON with 5 scores     |
  |                                  |
  |  +---------------------------+   |
  |  | Dimension    | Weight     |   |
  |  |--------------|------------|   |
  |  | empathy      | x 0.25    |   |
  |  | brevity      | x 0.20    |   |
  |  | actionability| x 0.20    |   |
  |  | safety       | x 0.20    |   |
  |  | naturalness  | x 0.15    |   |
  |  +---------------------------+   |
  |                                  |
  |  qualityScore = weighted avg     |
  +---------------+------------------+
                  |
                  v
  +----------------------------------+
  |  Verdict Logic                   |
  |                                  |
  |  qualityScore >= 6               |
  |    AND no forbidden words        |
  |    ---> PASS                     |
  |                                  |
  |  qualityScore < 6               |
  |    OR forbidden word found       |
  |    ---> FAIL                     |
  +---------------+------------------+
                  |
                  | (on LLM failure after 3 retries)
                  v
  +----------------------------------+
  |  Heuristic Fallback              |
  |  (regex-based, no LLM)           |
  |                                  |
  |  Empathetic keywords found?      |
  |    YES -> empathy = 7            |
  |    NO  -> empathy = 3            |
  |                                  |
  |  Word count:                     |
  |    <= 100 -> brevity = 8         |
  |    <= 130 -> brevity = 6         |
  |    > 130  -> brevity = 4         |
  |                                  |
  |  Action keywords found?          |
  |    YES -> actionability = 7      |
  |    NO  -> actionability = 4      |
  |                                  |
  |  safety = 8                      |
  |  (forbidden words already        |
  |   checked in fast-path)          |
  |                                  |
  |  Substantive content?            |
  |    YES -> naturalness = 7        |
  |    NO  -> naturalness = 2        |
  |                                  |
  |  Apply same weighted avg +       |
  |  verdict logic as above          |
  +----------------------------------+
```

---

## 5. Data Flow Diagram -- eval_events Instrumentation

How tool calls and guardrail events are captured during a chat request.

```
  User Message
         |
         v
  POST /api/chat
         |
         v
  +-------------------+
  |  LangChain Agent  |
  |  Loop             |
  |  (max 3 iterations|
  |   per request)    |
  +--------+----------+
           |
           |  On each iteration, one of these events fires:
           |
  +--------+--------+-----------------+------------------+
  |        |        |                 |                  |
  v        v        v                 v                  v
tool_call  |   hallucination     rate_limit          fallback
(success)  |   _blocked          (429 error)         (8b model)
  |        |        |                 |                  |
  |  (reserved)     |                 |                  |
  |  tool_result    |                 |                  |
  |        |        |                 |                  |
  +--------+--------+-----------------+------------------+
                    |
                    v
             onEvalEvent()
             (lib/langchain/streaming.js)
                    |
                    v
         +--------------------+
         |    eval_events     |
         |    table           |
         |                    |
         |  Columns:          |
         |  - id (UUID)       |
         |  - session_id      |
         |  - user_id         |
         |  - message_id      |
         |  - event_type      |
         |  - tool_name       |
         |  - tool_args (JSON)|
         |  - tool_result     |
         |  - llm_iteration   |
         |  - latency_ms      |
         |  - created_at      |
         +--------------------+
                    |
                    v
         +--------------------+
         |  Queryable for     |
         |  post-hoc debug:   |
         |                    |
         |  "Why did this     |
         |   scenario fail?"  |
         |                    |
         |  SELECT * FROM     |
         |  eval_events       |
         |  WHERE session_id  |
         |  = '<test-id>'     |
         |  ORDER BY          |
         |  created_at;       |
         +--------------------+
```

---

## 6. Reporter Root Cause Mapping

How the reporter categorizes failures and maps them to source locations.

```
  Failing Scenario Result
  { reason, suggestedFix, bug.description }
         |
         v
  +-------------------------------+
  |  Pattern Matching Engine      |
  |  (reporter.js)                |
  |                               |
  |  12 regex rules tested        |
  |  sequentially:                |
  |                               |
  |  /SAVE_TRIGGERS|hallucinated/ |
  |    -> category: tool          |
  |    -> file: streaming.js      |
  |                               |
  |  /remind_at|parseTime|hours/  |
  |    -> category: timing        |
  |    -> file: tools.js          |
  |                               |
  |  /dedup|duplicate|overlap/    |
  |    -> category: db            |
  |    -> file: db.js             |
  |                               |
  |  /forbidden|lazy|overdue/     |
  |    -> category: prompt        |
  |    -> file: prompts.js        |
  |                               |
  |  (no match)                   |
  |    -> category: unknown       |
  +------+------------------------+
         |
         v
  +-------------------------------+
  |  Group by category + file     |
  |                               |
  |  tool::streaming.js     [2]   |
  |  timing::tools.js       [1]   |
  |  prompt::prompts.js     [3]   |
  +------+------------------------+
         |
         v
  +-------------------------------+
  |  Triage Output                |
  |                               |
  |  Tool Guardrail -- 2 failures |
  |    File: streaming.js         |
  |    Hint: SAVE_TRIGGERS regex  |
  |                               |
  |    x No Tool Chat             |
  |      Reason: phantom save     |
  |      Fix: tighten triggers    |
  |                               |
  |    x Emotional Burnout        |
  |      Reason: hallucinated     |
  |      Fix: add guardrail       |
  |                               |
  |  Summary: 3 root cause groups |
  |  across 6 failures            |
  +-------------------------------+

  CATEGORY LABELS:
  +----------+------------------+
  | Key      | Display Label    |
  +----------+------------------+
  | tool     | Tool Guardrail   |
  | timing   | Time Parsing     |
  | db       | Database         |
  | prompt   | System Prompt    |
  | unknown  | Unknown          |
  +----------+------------------+
```

---

## 7. Baseline Regression Flow

How `--save-baseline` and `--compare-baseline` interact.

```
                         CLEAN RUN
                    (0 failures, 0 errors)
                             |
                             v
                  +---------------------+
                  |  --save-baseline    |
                  +----------+----------+
                             |
                             v
                  +---------------------+
                  |  baseline.json      |
                  |                     |
                  |  {                  |
                  |   runDate,          |
                  |   passRate,         |
                  |   avgQualityScore,  |
                  |   scenarioResults:  |
                  |    { id: {status,   |
                  |      qualityScore}} |
                  |  }                  |
                  +----------+----------+
                             |
         +-------------------+-------------------+
         |                                       |
         v                                       v
  NEXT RUN (future)                    NEXT RUN (future)
  --compare-baseline                   (no flag)
         |                                       |
         v                                       v
  +-------------------+                  (normal run,
  | For each scenario:|                   no comparison)
  | Compare vs saved  |
  +---+--------+------+
      |        |
      v        v
  +------+  +----------+
  | PASS |  | REGRESS  |
  | ->   |  | DETECTED |
  | FAIL |  |          |
  |      |  | quality  |
  |      |  | drop     |
  |      |  | > 1.5 pt |
  +------+  +----------+
      |        |
      +---+----+
          |
          v
  +-------------------+
  | Exit code:        |
  |  0 = no regress.  |
  |  1 = regression   |
  |      found        |
  +-------------------+
```
