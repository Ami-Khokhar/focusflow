# Flowy — Complete Application Architecture

## 1. Overview

Flowy is an ADHD-friendly AI productivity companion built with Next.js 14. It combines real-time streaming chat with a memory capture system, gentle check-in timers, daily briefings, and Web Push reminders — all wrapped in a persona that avoids shame language and focuses on empathy.

**Key design principles:**
- Empathy over productivity pressure
- Forbidden word filtering on every response
- Tool guardrails to prevent hallucinated side effects
- Dual-mode: Supabase (production) or in-memory (demo)

---

## 2. System Architecture

```
+=====================================================================+
|                          FLOWY APPLICATION                           |
+=====================================================================+
|                                                                      |
|  FRONTEND (React 18 + Next.js App Router)                            |
|  +----------------------------------------------------------------+  |
|  |  /app/page.js          Landing page (OAuth login)               |  |
|  |  /app/chat/page.js     Chat UI (SSE reader, Realtime, polling)  |  |
|  |  /app/layout.js        Root layout                              |  |
|  |  /app/auth/callback     OAuth code exchange                     |  |
|  |  /public/sw.js          Service Worker (Web Push)               |  |
|  +----------------------------------------------------------------+  |
|         |              |               |              |              |
|         | HTTP         | SSE stream    | Realtime     | Polling      |
|         | (fetch)      | (EventSource) | (WebSocket)  | (setInterval)|
|         v              v               v              v              |
|  API LAYER (Next.js API Routes, nodejs runtime)                      |
|  +----------------------------------------------------------------+  |
|  | POST /api/chat         Main streaming chat endpoint             |  |
|  | POST /api/chat/clear   Clear session history                    |  |
|  | GET  /api/session       Get/create today's session              |  |
|  | GET  /api/reminders     Poll for due reminders + check-ins      |  |
|  | GET  /api/cron/reminders  Cron: mark surfaced + Web Push        |  |
|  | POST /api/user           Create user (demo)                     |  |
|  | GET  /api/user/me        Get auth'd user (production)           |  |
|  | GET  /api/memory         Fetch memory items                     |  |
|  | POST /api/memory         Save memory item                      |  |
|  | PATCH /api/memory        Update reminder (keep/dismiss)         |  |
|  | DELETE /api/memory       Archive memory item                    |  |
|  | POST /api/push/subscribe   Register push subscription           |  |
|  | GET  /api/ping           Health check                           |  |
|  +----------------------------------------------------------------+  |
|         |              |               |                             |
|         v              v               v                             |
|  CORE LOGIC LAYER                                                    |
|  +----------------------------------------------------------------+  |
|  | lib/langchain/                                                  |  |
|  |   agent.js       Model creation (ChatGroq + tool binding)      |  |
|  |   streaming.js   Tool-calling loop, SSE token emission          |  |
|  |   tools.js       6 tools (save, delete, reschedule, etc.)      |  |
|  |   prompts.js     System prompt builder + forbidden word filter  |  |
|  |                                                                 |  |
|  | lib/db.js         22 DB functions (dual-mode Supabase/demo)     |  |
|  | lib/supabase.js   Client config + isDemoMode flag               |  |
|  | middleware.js     Auth gate (Supabase cookies + test bypass)     |  |
|  +----------------------------------------------------------------+  |
|         |              |                                             |
|         v              v                                             |
|  EXTERNAL SERVICES                                                   |
|  +----------------+  +------------------+  +---------------------+   |
|  | Groq API       |  | Supabase         |  | Web Push (VAPID)    |   |
|  | llama-3.3-70b  |  | PostgreSQL       |  | Browser push        |   |
|  | (chat + tools) |  | Realtime         |  | notifications       |   |
|  | llama-3.1-8b   |  | Auth (Google)    |  |                     |   |
|  | (fallback)     |  | RLS policies     |  |                     |   |
|  +----------------+  +------------------+  +---------------------+   |
+======================================================================+
```

---

## 3. Database Schema

```
+------------------+      +------------------+      +------------------+
|     users        |      |    sessions      |      |    messages      |
+------------------+      +------------------+      +------------------+
| id (PK, UUID)    |<--+  | id (PK, UUID)    |<--+  | id (PK, UUID)    |
| email            |   |  | user_id (FK)  ---+-+  | session_id (FK)--+|
| display_name     |   |  | started_at       |   |  | role             |
| timezone         |   |  | briefing_delivered|   |  | content          |
| onboarding_step  |   |  | active_task_id   |   |  | latency_ms       |
|   (0,1,2,3)      |   |  | check_in_due_at  |   |  | created_at       |
| main_focus       |   |  +------------------+   |  +------------------+
| biggest_struggle |   |                          |
| auth_user_id     |   |  +------------------+   |
| created_at       |   +--| memory_items     |   |
| last_active_at   |      +------------------+   |
+------------------+      | id (PK, UUID)    |   |
                           | user_id (FK)     |   |
+------------------+      | content          |   |
| daily_briefings  |      | category         |   |
+------------------+      |   (Task/Reminder/ |   |
| id (PK, UUID)    |      |    Note/Idea/Link)|   |
| user_id (FK)     |      | status           |   |
| briefing_date    |      |   (Active/Done/   |   |
| content          |      |    Archived)      |   |
| created_at       |      | captured_at      |   |
+------------------+      | remind_at        |   |
                           | surfaced_at      |   |
+------------------+      +------------------+   |
| push_subscriptions|                              |
+------------------+      +------------------+   |
| id (PK, UUID)    |      | eval_events      |   |
| user_id (FK)     |      +------------------+   |
| endpoint         |      | id (PK, UUID)    |   |
| p256dh           |      | session_id (FK)--+   |
| auth             |      | user_id (FK)     |
| updated_at       |      | event_type       |
+------------------+      | tool_name        |
                           | tool_args (JSONB)|
                           | tool_result      |
                           | llm_iteration    |
                           | latency_ms       |
                           | created_at       |
                           +------------------+
```

### Key table behaviors

- **users**: `onboarding_step` tracks 3-step flow (name -> focus -> struggle)
- **sessions**: One per user per day. `check_in_due_at` consumed atomically
- **memory_items**: Content deduplicated on insert (80% token overlap = reject)
- **memory_items.status**: Soft-delete via `Archived`, completion via `Done`
- **daily_briefings**: Cached once per day, served from cache on reload

---

## 4. Complete Chat Flow

```
User types message          Chat Page (React)         POST /api/chat           LangChain Agent
       |                         |                         |                        |
       |  click send              |                         |                        |
       +------------------------->|                         |                        |
       |                         |  fetch(POST /api/chat)   |                        |
       |                         +------------------------->|                        |
       |                         |                         |  1. Auth check          |
       |                         |                         |     (cookies/test tok)  |
       |                         |                         |                        |
       |                         |                         |  2. Load state          |
       |                         |                         |     user, session,      |
       |                         |                         |     memory items        |
       |                         |                         |                        |
       |                         |                         |  3. Detect mode         |
       |                         |                         |     briefing?           |
       |                         |                         |     onboarding?         |
       |                         |                         |     check-in?           |
       |                         |                         |     general chat?       |
       |                         |                         |                        |
       |                         |                         |  4. Build system prompt |
       |                         |                         |     persona + memory    |
       |                         |                         |     context + rules     |
       |                         |                         |                        |
       |                         |                         |  5. Create model +      |
       |                         |                         |     bind 6 tools        |
       |                         |                         +----------------------->|
       |                         |                         |                        |
       |                         |                         |          TOOL-CALLING LOOP
       |                         |                         |          (max 3 iterations)
       |                         |                         |                        |
       |                         |                         |  6. model.stream()     |
       |                         |                         |     +----- Groq API -->|
       |                         |                         |     |                  |
       |                         |                         |     |  tokens + tool   |
       |                         |                         |     |  calls returned  |
       |                         |                         |     |                  |
       |                         |                         |  7. Tool call?         |
       |                         |                         |     YES:               |
       |                         |                         |     a. Guardrail check |
       |                         |                         |        (SAVE_TRIGGERS/ |
       |                         |                         |         DELETE_TRIGGERS)|
       |                         |                         |     b. Execute tool    |
       |                         |                         |        (DB write)      |
       |                         |                         |     c. Refresh prompt  |
       |                         |                         |     d. Loop again      |
       |                         |                         |                        |
       |                         |                         |     NO:                |
       |                         |                         |     Final text response|
       |                         |                         |                        |
       |                    SSE  |  data: {"token":"Hi"}   |                        |
       |                    <----+<-------------------------+  8. Stream tokens      |
       |  render tokens          |  data: {"token":"!"}    |     via SSE            |
       |  live in UI             |  data: [DONE]           |                        |
       |<------------------------+                         |                        |
       |                         |                         |  9. filterForbidden()  |
       |                         |                         |     words applied       |
       |                         |                         |                        |
       |                         |                         |  10. Save to messages  |
       |                         |                         |      table             |
       |                         |                         |                        |
```

### Mode-specific behaviors

| Mode | Trigger | Special Logic |
|------|---------|---------------|
| **Briefing** | `message === '__MORNING_BRIEFING__'` | Check cache first. If uncached: summarize 3 items + ask to start. Cache result. |
| **Onboarding** | `onboarding_step < 3` | Ask for name (step 0), focus (step 1), struggle (step 2). Use `update_profile` tool. |
| **Check-in** | `check_in_due_at` past due | Consume atomically. Inject "check-in time" context into prompt. |
| **General** | Default | Full tool calling. Memory context injected. |

---

## 5. The 6 Tools

```
+-------------------------------------------------------------------+
|                    TOOL-CALLING PIPELINE                           |
+-------------------------------------------------------------------+
|                                                                    |
|  User Message                                                      |
|       |                                                            |
|       v                                                            |
|  +------------------+     +------------------+                     |
|  | SAVE_TRIGGERS    |     | DELETE_TRIGGERS   |                    |
|  | regex check      |     | regex check       |                    |
|  | remind|remember| |     | forget|delete|    |                    |
|  | save|note|...   |     | remove|clear|...  |                    |
|  +--------+---------+     +--------+----------+                    |
|           |                         |                              |
|     pass? |                   pass? |                              |
|           v                         v                              |
|  +--------+---------+     +--------+----------+                    |
|  | save_memory      |     | delete_memory     |                    |
|  | - content        |     | - content_hint    |                    |
|  | - category       |     |                   |                    |
|  | - remind_at OR   |     | Finds best match  |                    |
|  |   minutes_from   |     | by token overlap, |                    |
|  |   _now           |     | sets Archived     |                    |
|  | - Dedup check    |     +-------------------+                    |
|  +------------------+                                              |
|                                                                    |
|  +------------------+     +-------------------+                    |
|  | reschedule_      |     | complete_task     |                    |
|  |   reminder       |     | - content_hint    |                    |
|  | - new_time       |     |                   |                    |
|  |                  |     | Sets status=Done  |                    |
|  | Finds last       |     | on matching task  |                    |
|  | active reminder, |     +-------------------+                    |
|  | updates remind_at|                                              |
|  +------------------+     +-------------------+                    |
|                           | set_checkin_timer |                    |
|  +------------------+     | - minutes (def 25)|                    |
|  | update_profile   |     |                   |                    |
|  | - display_name   |     | Sets session      |                    |
|  | - main_focus     |     | check_in_due_at   |                    |
|  | - biggest_       |     +-------------------+                    |
|  |   struggle       |                                              |
|  |                  |     GUARDRAIL: If LLM calls save_memory or   |
|  | Auto-advances    |     delete_memory without trigger word match, |
|  | onboarding_step  |     the call is BLOCKED and logged as        |
|  +------------------+     "hallucination_blocked" eval event.      |
+-------------------------------------------------------------------+
```

### Tool summary

| Tool | Trigger | DB Effect | Guards |
|------|---------|-----------|--------|
| `save_memory` | "remind me", "remember", "save", "note" | INSERT memory_items | SAVE_TRIGGERS regex |
| `delete_memory` | "forget", "delete", "remove" | UPDATE status='Archived' | DELETE_TRIGGERS regex |
| `reschedule_reminder` | "snooze", "push back" | UPDATE remind_at | None (natural) |
| `complete_task` | "done!", "finished" | UPDATE status='Done' | None (natural) |
| `set_checkin_timer` | "yes", "sure" (after offer) | UPDATE session.check_in_due_at | None (natural) |
| `update_profile` | During onboarding | UPDATE users fields | None (onboarding only) |

---

## 6. Reminder & Check-In System

```
  CAPTURE                    STORAGE                    DELIVERY
  -------                    -------                    --------

  "remind me to              memory_items               Three delivery paths:
   call dentist               +------------------+
   in 2 hours"                | content: "call   |       1. REALTIME (instant)
       |                      |   dentist"       |       Supabase postgres_changes
       v                      | category:        |       on memory_items UPDATE
  save_memory tool             |   "Reminder"     |       (surfaced_at set by cron)
  minutes_from_now: 120       | status: "Active" |            |
       |                      | remind_at:       |            v
       v                      |   now + 2 hours  |       Chat page subscription
  DB INSERT                   | surfaced_at:     |       handleDueReminder()
                              |   null           |       displays in-chat alert
                              +------------------+
                                     |                  2. POLLING (15s fallback)
                                     |                  GET /api/reminders
                                     v                  queries: remind_at <= now
                              CRON JOB                       AND surfaced_at IS NULL
                              GET /api/cron/reminders        |
                              (every 1 min)                  v
                                     |                  Chat page poll callback
                                     |                  same handler as Realtime
                                     v
                              For each due reminder:    3. WEB PUSH
                              1. SET surfaced_at=now    Service Worker receives
                              2. SET remind_at=null     push event, shows
                              3. Send Web Push          browser notification
                              4. Trigger Realtime            |
                                                             v
                                                        Click -> focus /chat tab

  USER ACTIONS ON DELIVERED REMINDER
  -----------------------------------
  [Keep as note]  -> category='Note', clear remind_at, clear surfaced_at
  [Dismiss]       -> status='Archived'

  DEDUP: sessionStorage holds Set of delivered reminder IDs
         prevents re-firing on page reload
```

### Check-in timer flow

```
  User: "yes set the timer"
       |
       v
  set_checkin_timer(minutes=25)
       |
       v
  session.check_in_due_at = now + 25 min
       |
       v
  System prompt injects:
  "You have an active check-in until [time]"
       |
       v
  Polling (GET /api/reminders) every 15s
  calls consumeDueCheckIn(userId)
       |
       v
  check_in_due_at past? -----> NO: wait
       |
       YES (atomic UPDATE with WHERE clause)
       |
       v
  Chat page displays check-in message:
  "How's it going? Options:
   [Keep going] [Take a break] [Try something else]"
```

---

## 7. Onboarding Flow

```
  New user (onboarding_step = 0)
       |
       v
  +-------------------------------------------+
  |  Step 0 -> 1: NAME                        |
  |  Prompt: "Ask for their name warmly"       |
  |  User: "I'm Alex"                          |
  |  Tool: update_profile(display_name:"Alex") |
  |  DB: users.onboarding_step = 1             |
  +-------------------------------------------+
       |
       v
  +-------------------------------------------+
  |  Step 1 -> 2: FOCUS                        |
  |  Prompt: "Ask what they want help with"    |
  |  User: "staying on track with work"        |
  |  Tool: update_profile(main_focus:"...")     |
  |  DB: users.onboarding_step = 2             |
  +-------------------------------------------+
       |
       v
  +-------------------------------------------+
  |  Step 2 -> 3: STRUGGLE                     |
  |  Prompt: "Ask what usually gets in the way"|
  |  User: "I get distracted by my phone"      |
  |  Tool: update_profile(biggest_struggle:"")|
  |  DB: users.onboarding_step = 3 (COMPLETE)  |
  +-------------------------------------------+
       |
       v
  Normal chat mode with personalized context
  System prompt includes name, focus, struggle
```

---

## 8. Authentication Flow

```
  DEMO MODE (no Supabase env vars)
  ================================
  Landing page -> click "Try Demo" -> localStorage UUID -> /chat
  All DB calls use in-memory demoStore (Maps)
  No cookies, no auth middleware


  PRODUCTION MODE (Supabase configured)
  ======================================

  Landing page                  Supabase Auth              App Server
       |                             |                         |
       |  "Continue with Google"     |                         |
       +------ signInWithOAuth ----->|                         |
       |                             |  redirect to Google     |
       |  <---- Google consent ----->|                         |
       |                             |                         |
       |  /auth/callback?code=XXX    |                         |
       +-----------------------------+------------------------>|
       |                             |                         |
       |                             |  exchangeCodeForSession |
       |                             |<------------------------+
       |                             |  session cookies set    |
       |                             +------------------------>|
       |                             |                         |
       |                             |           Check: does app user
       |                             |           exist for this auth_user_id?
       |                             |                         |
       |                             |           NO: create user row
       |                             |           YES: proceed
       |                             |                         |
       |  redirect /chat             |                         |
       |<----------------------------------------------------------+
       |                             |                         |
       |  Every subsequent request:  |                         |
       |  middleware.js checks       |                         |
       |  supabase.auth.getUser()    |                         |
       |  from cookies               |                         |
       |                             |                         |
       |  /api/* routes also check:  |                         |
       |  createSupabaseServerClient |                         |
       |  -> getUser() -> lookup     |                         |
       |  app user by auth_user_id   |                         |
```

---

## 9. Streaming & SSE Pipeline

```
  SERVER SIDE                                    CLIENT SIDE
  (app/api/chat/route.js)                        (app/chat/page.js)

  new ReadableStream({                           const res = await fetch(POST /api/chat)
    async start(controller) {                    const reader = res.body.getReader()
      |                                          const decoder = new TextDecoder()
      v                                          let fullText = ''
      streamAgentResponse({                      |
        onToken: (token) => {                    while (true) {
          controller.enqueue(                      const { done, value } = reader.read()
            `data: {"token":"${token}"}\n\n`       if (done) break
          )       ------ SSE ------>               |
        },                                         for (line of chunk.split('\n')) {
      })                                             if (line.startsWith('data: ')) {
      |                                                const data = line.slice(6)
      v                                                if (data === '[DONE]') continue
      controller.enqueue('data: [DONE]\n\n')           const { token } = JSON.parse(data)
      controller.close()  ---- SSE [DONE] ---->        fullText += token
      |                                                setMessages(prev => update)
      v                                              }
      saveMessage(sessionId, 'assistant', text)    }
    }                                            }
  })                                             return fullText


  TOOL-CALLING LOOP (lib/langchain/streaming.js)
  ================================================

  Iteration 1:
    model.stream(messages) -> chunks[] + tool_calls[]
    |
    +-- text tokens? --> emit via onToken()
    +-- tool_calls? --> YES:
          |
          +-- Guardrail: SAVE_TRIGGERS / DELETE_TRIGGERS match?
          |     NO  -> block, log hallucination_blocked
          |     YES -> execute tool, log tool_call
          |
          +-- Memory changed? -> refresh system prompt
          +-- Push ToolMessage to messages[]
          +-- Continue to iteration 2

  Iteration 2:
    model.stream(messages + tool results)
    |
    +-- text tokens? --> emit
    +-- tool_calls? --> execute again (rare)
    +-- no more tool_calls? --> DONE

  Iteration 3: (safety limit, loop breaks)

  FALLBACK CHAIN:
    Empty response?
    |
    +-- Retry with llama-3.1-8b (no tools, original messages)
    |     Success? -> emit tokens
    |     Fail? -> hardcoded "Hey! I'm here. What's on your mind?"
```

---

## 10. Emotional Intelligence & Safety

### Forbidden Words Filter

Applied to **every** LLM response before saving to DB.

```
  LLM Response Text
       |
       v
  filterForbiddenWords(text)
       |
       +-- "easy"           -> "here is a starting point"
       +-- "simple"         -> "here is a starting point"
       +-- "just"           -> "" (removed)
       +-- "you should"     -> "one option is"
       +-- "you need to"    -> "you could try"
       +-- "overdue"        -> "still on the list"
       +-- "missed"         -> "still available"
       +-- "failed"         -> "not completed yet"
       +-- "late"           -> "whenever you are ready"
       +-- "behind"         -> "at your own pace"
       +-- "lazy"           -> "" (removed)
       +-- "easily"         -> "" (removed)
       +-- "distracted"     -> "" (removed)
       +-- "you promised"   -> "" (removed)
       +-- "don't forget"   -> "" (removed)
       |
       v
  Cleaned response saved to DB
```

### System Prompt Rules (Key Excerpts)

1. Never give a numbered list of steps — give ONE tiny first step
2. Acknowledge feelings ONCE then move forward (no empathy loops)
3. Never recap what a tool did ("I saved that" is invisible to user)
4. Use `minutes_from_now` for relative times (server-computed accuracy)
5. When user says "yes"/"ok" — context is YOUR last message, act on it
6. Keep responses under 100 words for chat, longer only for task decomposition

---

## 11. File Map

| File | Lines | Purpose |
|------|-------|---------|
| **Frontend** | | |
| `app/page.js` | 91 | Landing page with OAuth login |
| `app/chat/page.js` | 718 | Chat UI: SSE reader, Realtime subscriptions, polling, onboarding |
| `app/layout.js` | 25 | Root layout (Inter font, globals.css) |
| `app/globals.css` | 200+ | Tailwind + custom styles |
| `app/privacy/page.js` | ~50 | Privacy policy page |
| `app/auth/callback/route.js` | ~30 | OAuth code exchange + user creation |
| `public/sw.js` | 32 | Service Worker for Web Push |
| `public/logo.png` | — | Flowy logo |
| **API Routes** | | |
| `app/api/chat/route.js` | 260 | Main streaming endpoint (LangChain agent) |
| `app/api/chat/clear/route.js` | ~15 | Clear session messages |
| `app/api/session/route.js` | ~50 | Get/create today's session + messages |
| `app/api/user/route.js` | ~40 | Create/get user (demo mode) |
| `app/api/user/me/route.js` | ~25 | Get authenticated user (production) |
| `app/api/memory/route.js` | ~80 | CRUD for memory items |
| `app/api/reminders/route.js` | 52 | Poll for due reminders + check-ins |
| `app/api/cron/reminders/route.js` | 75 | Cron: mark surfaced + send Web Push |
| `app/api/debug/route.js` | ~30 | Dev-only env checker |
| `app/api/ping/route.js` | 5 | Health check |
| **Core Logic** | | |
| `lib/langchain/agent.js` | ~60 | Model creation (ChatGroq + API key rotation) |
| `lib/langchain/streaming.js` | 252 | Tool-calling loop, fallback chain, eval events |
| `lib/langchain/tools.js` | 160 | 6 LangChain tools with closured userId/sessionId |
| `lib/langchain/prompts.js` | 101 | System prompt builder + forbidden word filter |
| `lib/db.js` | 838 | 22+ DB functions, dual-mode (Supabase / in-memory demo) |
| `lib/supabase.js` | ~40 | Supabase client setup, isDemoMode flag |
| **Infrastructure** | | |
| `middleware.js` | 70 | Auth gate (Supabase cookies, test token, cron secret) |
| `supabase/schema.sql` | 87 | Table definitions |
| `supabase/migrations/*.sql` | 3 files | RLS, auth columns, eval_events |
| `package.json` | 40 | Dependencies + scripts |

---

## 12. Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Next.js (App Router, nodejs runtime) | 14.2 |
| React | React | 18.2 |
| Database | Supabase (PostgreSQL) | 2.42 |
| LLM (Chat) | Groq llama-3.3-70b-versatile | — |
| LLM (Fallback) | Groq llama-3.1-8b-instant | — |
| Agent Framework | LangChain (@langchain/groq) | 1.1.4 |
| Markdown | react-markdown | 9.0 |
| Realtime | Supabase Realtime (postgres_changes) | — |
| Push | web-push (VAPID) | 3.6 |
| Validation | Zod | 4.3 |
| Deployment | Vercel | — |

---

## 13. Environment Variables

### Required (production)

```bash
NEXT_PUBLIC_SUPABASE_URL=https://...supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
GROQ_API_KEY=gsk_...
```

### Required (Web Push)

```bash
NEXT_PUBLIC_VAPID_PUBLIC_KEY=BJ...
VAPID_PRIVATE_KEY=...
VAPID_EMAIL=mailto:you@example.com
```

### Required (Cron)

```bash
CRON_SECRET=your-secret-here
```

### Optional (Testing)

```bash
TEST_MODE=true
TEST_TOKEN=test-secret-key-123
```

---

## 14. Key Design Decisions

1. **Native tool calling over AgentExecutor** — Uses `model.bindTools()` + `model.stream()` directly (simpler, lighter, easier to debug)
2. **Streaming SSE over WebSocket** — Every response streams tokens in real-time for low perceived latency
3. **Tool guardrails via regex** — Prevents hallucinated side effects (phantom saves/deletes) without complex chain-of-thought
4. **Forbidden word filter as post-processing** — Applied after streaming, before DB save. User sees unfiltered tokens live but DB always has clean version
5. **Dual-mode (Supabase / demo)** — Every DB function checks `isDemoMode` first. Demo uses in-memory Maps for zero-config development
6. **Briefing caching** — Computed once per day via LLM, cached in `daily_briefings` table. Subsequent loads serve cached version instantly
7. **Realtime + polling hybrid** — Realtime for instant delivery, polling as fallback. Both deduplicated via sessionStorage
8. **Atomic check-in consumption** — SQL UPDATE with WHERE clause ensures timer fires exactly once
9. **Content deduplication on save** — 80% token overlap check prevents user from accidentally saving the same thing twice
10. **Memory context cap** — Max 15 items injected into system prompt to stay within token limits
