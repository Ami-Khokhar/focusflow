# FocusFlow AI Testing System

An AI-powered QA agent framework that automatically tests FocusFlow's conversational flows, detects bugs, and suggests fixes.

---

## Architecture

```
focusflow-ai-tests/
├── agents/
│   ├── userSimulator.js      # Generates realistic ADHD user messages via Groq
│   ├── behaviorEvaluator.js  # PASS/FAIL coaching quality evaluation
│   └── bugDetector.js        # Rule-based DB state diffing + LLM cross-check
├── prompts/
│   ├── simulatorPrompt.js    # Prompt for ADHD user simulation
│   ├── evaluatorPrompt.js    # Prompt for coaching quality evaluation
│   └── bugPrompt.js          # Prompt for DB bug analysis
├── tests/
│   ├── scenarios.js          # 8 deterministic test scenarios
│   └── runTests.js           # Orchestrator (entry point)
├── utils/
│   ├── apiClient.js          # SSE streaming HTTP client for /api/chat
│   ├── dbClient.js           # Supabase service-role query helpers
│   └── reportGenerator.js    # Terminal output + Markdown/JSON reports
├── reports/                  # Generated report files (auto-created)
├── .env.example              # Environment variable template
└── README.md
```

### Three AI Roles

| Agent | Model | Job |
|-------|-------|-----|
| **User Simulator** | `llama-3.1-8b-instant` | Generates realistic ADHD user messages |
| **Behavior Evaluator** | `llama-3.3-70b-versatile` | PASS/FAIL on tone, empathy, coaching style |
| **Bug Detector** | Rule-based + `llama-3.3-70b-versatile` | DB state verification |

---

## Setup

### Prerequisites

- Node.js 18+
- FocusFlow dev server running (`npm run dev`)
- Groq API key
- Supabase project (optional — see Demo Mode below)

### 1. Install dependencies

```powershell
cd focusflow-ai-tests
npm install
```

### 2. Configure environment

Copy the template and fill in your values:

```powershell
copy .env.example .env
```

Edit `.env`:

```env
FOCUSFLOW_URL=http://localhost:3000
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
GROQ_API_KEY=your-groq-api-key
```

> **Note:** Use the **Service Role** key (not the anon key) so the test suite can bypass RLS policies to read and clean up test data.

> **Demo Mode:** If `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` are not set, the suite runs against FocusFlow's in-memory demo store. DB-level checks are skipped and only response quality is evaluated.

---

## Running Tests

### Full suite (8 scenarios)

```powershell
# From the FocusFlow root:
npm run ai-test

# Or from the test folder:
cd focusflow-ai-tests
npm test
```

### Single scenario

```powershell
npm run ai-test -- --scenario memory_capture
```

Available scenario IDs:

- `memory_capture`
- `reminder_creation`
- `reminder_reschedule`
- `memory_recall`
- `decomposition`
- `task_complete`
- `check_in_acceptance`
- `memory_delete`

### Randomized ADHD conversation (10 turns)

```powershell
npm run ai-test -- --random
```

### Long conversation test (20 turns)

```powershell
npm run ai-test -- --long
```

---

## Output

### Terminal

```
🧠 FocusFlow AI Test Suite

   API:      http://localhost:3000
   Mode:     Full suite (8 scenarios)
   Server:   ✓ reachable

  Running scenarios...

  ✓ Memory Capture              PASS
      → Warmly acknowledged the captured item.
  ✓ Reminder Creation           PASS
  ✗ Reminder Reschedule         FAIL
      → remind_at did not update after reschedule.
      💡 Check rescheduleLastReminder() in lib/db.js
  🐛 Bug: remind_at is null after update
     Fix: Ensure parseTimeOffset() returns ms and the update query targets the correct row.
  ...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  FocusFlow AI Test Report
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Total:    8
  Pass:     7
  Fail:     1
  Duration: 24.3s
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  📄 Report: focusflow-ai-tests/reports/test-report-2026-03-05T21-12-00.md
  📊 JSON:   focusflow-ai-tests/reports/test-report-2026-03-05T21-12-00.json
```

### Report files (in `focusflow-ai-tests/reports/`)

| File | Contents |
|------|----------|
| `test-report-<timestamp>.md` | Full Markdown report with bug details |
| `test-report-<timestamp>.json` | Machine-readable report for CI |
| `transcripts-<timestamp>.txt` | Full conversation transcripts |

---

## CI Integration

The test runner exits with code `1` if any scenario fails — making it CI-ready:

```yaml
# GitHub Actions example
- name: Run FocusFlow AI Tests
  run: npm run ai-test
  env:
    FOCUSFLOW_URL: http://localhost:3000
    SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
    SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
    GROQ_API_KEY: ${{ secrets.GROQ_API_KEY }}
```

---

## Test Scenarios

| # | Scenario | User Message | Checks |
|---|----------|-------------|--------|
| 1 | Memory Capture | "remember to call mom" | New `memory_items` row created |
| 2 | Reminder Creation | "remind me to send the email in 10 minutes" | `remind_at ≈ now+10min` |
| 3 | Reminder Reschedule | "actually push that back 30 minutes" | `remind_at` updated |
| 4 | Memory Recall | "what do you remember?" | Response lists stored items |
| 5 | Task Decomposition | "I'm overwhelmed with this project" | ONE step + focus session offered |
| 6 | Task Completion | "done!!" | Item `status = 'Done'` |
| 7 | Check-in Acceptance | "yes please set that timer" | `session.check_in_due_at ≈ now+25min` |
| 8 | Memory Deletion | "forget that actually" | Item `status = 'Archived'` |

---

## Adding New Scenarios

Add a new object to the `scenarios` array in `tests/scenarios.js`:

```js
{
  id: 'my_new_scenario',
  name: 'My New Scenario',
  description: 'What this tests.',
  goal: 'Context for the User Simulator.',
  seedMessage: 'the exact user message to send',
  expectedIntent: 'memory_capture',
  expectedBehavior: 'What the evaluator should verify.',
  expectedDbChange: 'What DB change is expected.',

  async setup(db, userId, sessionId) {
    // Seed any required DB state
    return { someData: 'value' };
  },

  async dbCheck(db, userId, sessionId, seedData, before, after, assistantResponse) {
    // Return a bug report object
    return { bugFound: false, description: '', reproSteps: '', suggestedFix: '' };
  },
}
```

---

## Evaluation Criteria

The **Behavior Evaluator** checks every response against FocusFlow's standards:

- ✅ Empathetic, warm tone
- ✅ Coaching style (not robotic assistant)
- ✅ One tiny actionable step
- ✅ No forbidden words: `lazy`, `easy`, `overdue`, `should have`, `failed`, `just do it`
- ✅ Correct intent acknowledgment
- ✅ Focus session offered when decomposing tasks
