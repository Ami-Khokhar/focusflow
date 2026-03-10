# Claude Code Configuration - FocusFlow v0.1 + Ruflo v3.5

> **FocusFlow** — A Next.js 14 productivity AI application with built-in reminders, memory capture,
> and emotional intelligence. Now enhanced with **Ruflo v3.5** agent orchestration for rapid development.

## Behavioral Rules (Always Enforced)

- Do what has been asked; nothing more, nothing less
- NEVER create files unless they're absolutely necessary for achieving your goal
- ALWAYS prefer editing an existing file to creating a new one
- NEVER proactively create documentation files (*.md) or README files unless explicitly requested
- NEVER save working files, text/mds, or tests to the root folder
- Never continuously check status after spawning a swarm — wait for results
- ALWAYS read a file before editing it
- NEVER commit secrets, credentials, or .env files

## File Organization

- NEVER save to root folder — use the directories below
- Use `/app` for Next.js App Router pages and API routes
- Use `/lib` for utilities and shared functions
- Use `/public` for static assets
- Use `/supabase` for database migrations and config
- Use `/.claude` for Claude Code tooling, agents, hooks, helpers
- Use `/docs` for documentation and markdown files (if needed)

## Flowy — Guide for AI Assistantsure

### Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Framework** | Next.js | 14.2.0 (App Router, nodejs runtime) |
| **React** | React | 18.2.0 |
| **Database** | Supabase (PostgreSQL) | 2.42.0 |
| **LLM (App)** | Groq | llama-3.3-70b-versatile + llama-3.1-8b-instant |
| **LLM (Claude Code)** | Anthropic Claude | claude-opus-4-6 (default) |
| **Markdown** | react-markdown | 9.0.0 |
| **Realtime** | Supabase Realtime | postgres_changes |
| **Deployment** | Vercel | - |

### Key Files & Paths

| Path | Purpose | Key Functions |
|------|---------|----------------|
| `app/api/chat/route.js` | Main streaming chat endpoint | classifyIntentWithLLM, buildSystemPrompt, streamChatResponse |
| `app/api/session/route.js` | Session management | getOrCreateSession, updateSession |
| `app/api/memory/route.js` | Memory CRUD | saveMemoryItem, getMemoryItems, deleteMemoryItem |
| `app/api/reminders/route.js` | Due reminder polling | getDueReminders |
| `app/api/cron/reminders/route.js` | Vercel Cron handler | markReminderSurfaced |
| `app/chat/page.js` | React UI with SSE streaming | Chat component, Realtime subscription |
| `lib/db.js` | All database operations | 20+ functions, dual-path (demo/Supabase) |
| `lib/llm.js` | Groq SDK integration | streamChatResponse, classifyIntentWithLLM |
| `lib/prompts.js` | System prompts & intent detection | buildSystemPrompt, detectIntent, FORBIDDEN_WORDS |
| `lib/timeParser.js` | Natural language time parsing | parseRemindTime, parseTimeOffset |
| `lib/supabase.js` | Supabase client config | isDemoMode flag, client instantiation |

### Intent Classification (Multi-Mode)

FocusFlow's chat API detects 8 intents and routes to different system prompts:

| Intent | Trigger | Mode | DB Effect |
|--------|---------|------|-----------|
| `memory_capture` | "remind me", "remember" | Save to memory | INSERT memory_item |
| `memory_recall` | "what have I told you?" | Fetch memory | SELECT memory_items |
| `memory_delete` | "forget that" | Delete memory | DELETE memory_item |
| `reminder_reschedule` | "snooze", "push back" | Update reminder | UPDATE memory_item |
| `decomposition` | "I'm stuck", "overwhelmed" | Task breakdown | INSERT memory_item (Task) |
| `check_in` | Timer-driven | Check-in dialog | Query check_in_due_at |
| `check_in_acceptance` | Affirmative reply | Set timer | UPDATE session.check_in_due_at |
| `briefing` | First message / `/briefing` | Daily summary | SELECT/INSERT daily_briefings |
| `general` | Everything else | Chat | None |

**Classification strategy:**

- **Primary:** Groq `llama-3.1-8b-instant` (zero-temp JSON classifier, 0.7 confidence threshold)
- **Fallback:** Regex-based detector (when API fails or in demo mode)

### Database Schema (Supabase)

| Table | Purpose | Row Count (typical) |
|-------|---------|-------------------|
| `users` | User records (display_name, timezone) | 1 per user |
| `sessions` | One-per-user-per-day, tracks briefing_delivered, check_in_due_at | 1 per user per day |
| `messages` | Chat history (role: user\|assistant) | 50-500 per session |
| `memory_items` | Captured memories, tasks, reminders, ideas | 20-200 per user |
| `daily_briefings` | Cached daily briefing responses | 1 per user per day |

**RLS:** Currently disabled (anon key access). If enabling RLS, ensure policies allow user_id-based access.

### Chat Flow (End to End)

1. **User opens app** → `POST /api/user` creates UUID, localStorage stores `focusflow_user_id`
2. **Chat page loads** → `GET /api/session?userId=...` fetches or creates today's session
3. **SSE subscription** → Supabase Realtime listens to `memory_items` updates
4. **Polling fallback** → Every 30-60s hits `GET /api/reminders?userId=...` for due reminders
5. **User sends message** → `POST /api/chat` with `{ message, sessionId, userId, mode: 'chat', timezone }`
6. **Intent detection** → Groq classifier (primary) or regex fallback determines mode
7. **Mode-specific effects** → Save/delete memory, update reminders, set check-in timer
8. **System prompt build** → `buildSystemPrompt()` injects persona + mode rules + memory context
9. **LLM call** → Groq `llama-3.3-70b-versatile` with streaming
10. **SSE response** → Client reads stream, appends tokens in real-time
11. **Save to DB** → After stream ends, full response saved as assistant message

### Environment Variables (Required & Optional)

**Required for production:**

```bash
NEXT_PUBLIC_SUPABASE_URL=https://...supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
GROQ_API_KEY=gsk_...
```

**Optional (for Ruflo MCP integration):**

```bash
ANTHROPIC_API_KEY=sk-ant-...  # For Ruflo's Claude models
CLAUDE_FLOW_V3_ENABLED=true   # Enable Ruflo swarm features
CLAUDE_FLOW_HOOKS_ENABLED=true # Enable lifecycle hooks
```

## Concurrency: 1 MESSAGE = ALL RELATED OPERATIONS

- All operations MUST be concurrent/parallel in a single message
- Use Claude Code's Task tool for spawning agents, not just MCP

**Mandatory patterns:**

- ALWAYS batch ALL todos in ONE TodoWrite call (5-10+ minimum)
- ALWAYS spawn ALL agents in ONE message with full instructions via Task tool
- ALWAYS batch ALL file reads/writes/edits in ONE message
- ALWAYS batch ALL terminal operations in ONE Bash message
- ALWAYS batch ALL memory store/retrieve operations in ONE message

## 3-Tier Model Routing (Ruflo ADR-026)

| Tier | Handler | Latency | Cost | Use Cases |
|------|---------|---------|------|-----------|
| **1** | Agent Booster (WASM) | <1ms | $0 | Simple transforms (var→const, add types) — **Skip LLM entirely** |
| **2** | Haiku | ~500ms | $0.0002 | Simple tasks, low complexity (<30%) |
| **3** | Sonnet/Opus | 2-5s | $0.003-0.015 | Complex reasoning, architecture, security (>30%) |

- Use Opus (default) for architecture, security, and refactoring decisions
- Use Haiku for simple edits and clarification questions
- Use Agent Booster when available for pure transformations

## Swarm Orchestration (When Requested)

For complex feature development or refactoring tasks, **immediately initialize a swarm:**

```javascript
// STEP 1: Initialize swarm via MCP
mcp__ruv-swarm__swarm_init({
  topology: "hierarchical",
  maxAgents: 8,
  strategy: "specialized"
})

// STEP 2: Spawn agents in parallel via Task tool
Task("Coordinator", "Coordinate agents and store decisions in shared memory", "hierarchical-coordinator")
Task("Architect", "Design the feature / refactoring approach", "system-architect")
Task("Coder", "Implement based on architect's design", "coder")
Task("Tester", "Write tests for coverage validation", "tester")

// STEP 3: Batch todos
TodoWrite([
  {content: "Design architecture", status: "in_progress", activeForm: "Designing"},
  {content: "Implement feature", status: "pending", activeForm": "Implementing"},
  {content: "Write tests", status: "pending", activeForm: "Testing"}
])

// STEP 4: Store swarm state
mcp__claude-flow__memory_store({
  namespace: "swarm",
  key: "current-task",
  value: "[detailed task description]"
})
```

### Anti-Drift Swarm Config (Preferred)

- **Topology:** hierarchical (tight coordinator control)
- **Max Agents:** 6-8 (focus, not overload)
- **Strategy:** specialized (clear role boundaries)
- **Consensus:** raft (one leader for authoritative state)
- **Memory:** shared namespace for all agents
- **Checkpoints:** post-task hooks verify progress

## Testing & Verification

- **Demo mode:** When env vars missing, app runs with hardcoded demo responses
- **Test Supabase:** Use `npm run test` after setup (requires NEXT_PUBLIC_SUPABASE_URL)
- **API testing:** Use `/api/debug` endpoint to check configuration (marked for deletion in future)
- **Cron testing:** Vercel cron requires `CRON_SECRET` header in production

## Code Quality Standards

- Keep API route handlers under 200 lines
- Extract complex logic to `lib/` functions
- Use typed imports for Supabase client
- Always include error boundaries in React components
- Test intent detection with both Groq API and regex fallback
- Document non-obvious time parsing logic with examples

---

## Quick Reference: Common Tasks

### Add a New Memory Category

1. Update `memory_items` table CHECK constraint in Supabase
2. Update `MEMORY_CATEGORIES` in `lib/prompts.js`
3. Update system prompt to handle new category
4. Test with `POST /api/memory` with new category

### Change LLM Model

1. Update `lib/llm.js` → `GROQ_CHAT_MODEL` or `GROQ_CLASSIFIER_MODEL`
2. Adjust max_tokens and temperature if needed
3. Test intent classification accuracy with regex fallback

### Extend Intent Detection

1. Add regex pattern to `detectIntent()` in `lib/prompts.js`
2. Add LLM classifier examples to `classifyIntentWithLLM()` prompt
3. Add corresponding mode + system prompt in `buildSystemPrompt()`
4. Test with both Groq API and demo mode

### Enable Supabase RLS

1. Create RLS policies in `supabase/migrations/` (DDD approach)
2. Test with both anon key (public access) and service role key
3. Ensure `filterMemoryItemsByUser()` uses RLS correctly

---

**Attribution:** This CLAUDE.md combines FocusFlow's project-specific guidance with Ruflo v3.5's
agent orchestration and behavioral best practices. The agent infrastructure is provided by
[claude-flow](https://github.com/ruvnet/claude-flow). Chat intelligence is powered by
[Groq](https://groq.com) and [Anthropic Claude](https://anthropic.com).
