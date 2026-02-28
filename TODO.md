# FocusFlow MVP — TODO List
>
> Generated from PRD v1.0 + SRS v1.0 · Target: Week 1–8 Beta Launch

---

## 🆓 Recommended Free-Tier Tech Stack

| Layer | Service | Free Limit | Notes |
|---|---|---|---|
| **Frontend** | [Next.js](https://nextjs.org) | Free (open source) | React-based, mobile-ready |
| **Hosting** | [Vercel](https://vercel.com) | Free tier | Auto-deploys from GitHub |
| **Database + Auth** | [Supabase](https://supabase.com) | 500 MB DB, 50k MAU | PostgreSQL + magic link auth + encryption built-in |
| **LLM API** | [Groq](https://console.groq.com) | Free tier (rate-limited) | Llama 3.3 70B — fast, good quality, free to start |
| **LLM Fallback** | [Claude Haiku](https://anthropic.com) | Pay-as-you-go | ~$0.25/1M tokens — cheapest quality fallback |
| **Email (magic links)** | [Resend](https://resend.com) | 3,000 emails/month free | Works natively with Supabase Auth |
| **Version Control** | [GitHub](https://github.com) | Free | |

> **Estimated cost for 50 beta users: $0–5/month** depending on LLM usage. Start fully free on Groq.

---

## 🏗️ Phase 1 — Project Setup & Infrastructure (Week 1)

### Stack & Repo

- [ ] Initialize **Next.js** frontend project (`npx create-next-app@latest`)
- [ ] Use **Next.js API routes** as the backend (avoids separate backend server)
- [ ] Set up monorepo or separate repos with clear folder structure
- [ ] Configure environment variables (LLM API key, DB URL, etc.)
- [ ] HTTPS is automatic on Vercel — no extra setup needed
- [ ] Connect GitHub repo to **Vercel** for zero-config deploy (preview URLs per branch = free staging)
- [ ] Set environment variables in Vercel dashboard (LLM key, Supabase URL, etc.)

### Database — **Supabase** (free tier)

- [ ] Create a new project on [supabase.com](https://supabase.com)
- [ ] Create `users` table (id, email, display_name, timezone, created_at, last_active_at)
- [ ] Create `memory_items` table (id, user_id, content, category, status, captured_at, surfaced_at)
- [ ] Create `sessions` table (id, user_id, started_at, briefing_delivered, active_task_id, check_in_due_at)
- [ ] Create `messages` table (id, session_id, role, content, created_at)
- [ ] Encryption at rest: **enabled by default on Supabase** (SEC-02 ✅)
- [ ] Enable daily backups in Supabase dashboard — free tier includes point-in-time restore (REL-03)

---

## 🔐 Phase 2 — Authentication (Week 1) — **Supabase Auth** (free)

- [ ] Enable magic link auth in Supabase Auth settings — zero code needed (AUTH-01)
- [ ] Configure **Resend** as the email provider in Supabase (free, 3k/mo)
- [ ] Supabase handles session tokens automatically — set expiry to 30 days (SEC-03, AUTH-02)
- [ ] Use Supabase Row Level Security (RLS) to isolate each user's data (AUTH-03)
- [ ] Allow user to set a display name post-login (AUTH-04 · P1)
- [ ] Auto-detect and store user timezone from browser (`Intl.DateTimeFormat().resolvedOptions().timeZone`)
- [ ] Show privacy policy before first use explaining data usage (SEC-05)

---

## 💬 Phase 3 — Chat UI (Week 1–2)

- [ ] Build single-page chat interface (mobile-first, minimum 375px width · UX-01)
- [ ] Set all body text to minimum 16px on mobile (UX-02)
- [ ] Anchor text input field to bottom of viewport on mobile (UX-03)
- [ ] Make agent messages visually distinct from user messages (UX-04)
- [ ] Add scrollable chat history area (UX-04)
- [ ] Add typing indicator while LLM generates a response (CONV-04)
- [ ] Render agent messages with Markdown support (bold, lists, line breaks · CONV-05 · P1)
- [ ] Show 3-sentence onboarding message for first-time users (UX-05)
- [ ] Ensure UI loads in under 3 seconds on 4G mobile (PERF-03)

---

## 🤖 Phase 4 — LLM Integration & Prompt Engine (Week 1–2) — **Groq free tier**

- [ ] Sign up at [console.groq.com](https://console.groq.com) and get free API key
- [ ] Use model: `llama-3.3-70b-versatile` (free, fast, high quality)
- [ ] Build prompt assembly engine that injects:
  - [ ] Agent persona + tone guidelines
  - [ ] User name, current time, and timezone
  - [ ] Structured task list and recent captured items
  - [ ] Interaction mode context (morning briefing / task decomposition / general chat)
- [ ] Cap system prompt at under 2000 tokens (SRS 5.3)
- [ ] Cap conversation context sent to LLM at last 20 messages (CONV-01, LLM cost)
- [ ] Implement streaming token-by-token response display (PERF-04 · P1)
- [ ] Handle LLM API failures gracefully — show friendly retry message, never raw errors (REL-02)
- [ ] Log LLM API latency, error rates, and token usage per request (monitoring)
- [ ] Set up alert if LLM error rate exceeds 2% over 5 minutes

---

## 🌅 Phase 5 — Morning Briefing (Week 1–2)

- [ ] On session start between 05:00–12:00 local time, auto-trigger morning briefing if not yet delivered today (BRIEF-01)
- [ ] Briefing message must include: warm greeting by name + current date + max 3 prioritized tasks (BRIEF-02)
- [ ] End briefing with offer to help start the first task (BRIEF-03)
- [ ] If user has no stored tasks, ask: "What is the most important thing you need to do today?" (BRIEF-04)
- [ ] Mark briefing as delivered for the day — do not repeat if chat is reopened (BRIEF-05)
- [ ] Implement task prioritization by recency + urgency signals (BRIEF-06 · P1)
- [ ] Cache morning briefing content for 1 hour to reduce redundant LLM calls (cost optimization)
- [ ] Write integration tests for briefing logic with mock time (edge cases: boundary of 12:00, already delivered, no tasks)

---

## 🧩 Phase 6 — Task Decomposition (Week 3–4)

- [ ] Detect when user describes a task they are stuck on and trigger decomposition flow
- [ ] If task is ambiguous, ask exactly one clarifying question before decomposing (DECOMP-02)
- [ ] Always decompose to a single concrete, immediately-actionable first step (DECOMP-01)
- [ ] After first step, always ask: "Want me to check in with you in 25 minutes?" (DECOMP-03)
- [ ] If user confirms check-in, set a 25-minute session timer (DECOMP-04)
- [ ] If user returns still stuck, offer a sub-2-minute first step — never judge (DECOMP-05)
- [ ] Add LLM guardrail: never use "easy", "simple", "just", or "obviously" in task step responses (DECOMP-06)

---

## 🧠 Phase 7 — Memory Capture & Recall (Week 3–4)

- [ ] Agent acknowledges every captured item and confirms what it understood (MEM-01)
- [ ] Persist all captured items to DB — survive browser refresh and new sessions (MEM-02)
- [ ] Respond to "what have I told you?" with grouped summary: Tasks / Reminders / Notes / Ideas / Links (MEM-03)
- [ ] Include relevant captured items in morning briefing generation (MEM-04)
- [ ] Allow "forget that" or "delete that last thing" to remove most recent item (MEM-05 · P1)
- [ ] Auto-categorize captured items into: Task, Reminder, Note, Idea, or Link (MEM-06 · P1)
- [ ] Expose `GET /api/memory` endpoint — returns active items sorted by captured_at desc
- [ ] Expose `DELETE /api/memory/:id` endpoint — soft-deletes (archives) item
- [ ] Write integration tests for memory persistence across session resets

---

## ⏰ Phase 8 — Shame-Free Check-Ins (Week 3–4)

- [ ] When task session is active and 25 min of inactivity pass, send check-in on user's next interaction (CHECK-01)
- [ ] Check-in language must be warm and neutral — never use: overdue, missed, failed, late, behind (CHECK-02)
- [ ] If user reports distraction/non-completion, respond with acceptance + offer to reschedule (CHECK-03)
- [ ] Optionally include: "Want to try a 5-minute version instead?" in check-in (CHECK-04 · P1)
- [ ] Only trigger check-ins when user explicitly started a task session — never speculatively (CHECK-05)

---

## 🧪 Phase 9 — Testing & QA (Week 4–5)

### Automated Tests

- [ ] Write integration tests for all P0 functional requirements (SRS 8.1)
- [ ] Test forbidden word list against representative set of LLM responses (snapshot test)
- [ ] Test memory persistence across simulated session resets

### Prompt Quality Review

- [ ] Prompt engineer evaluates 50+ agent responses across all 4 feature flows against tone requirements (SRS 8.3)
- [ ] Any response with a forbidden word is treated as a P0 bug and fixed
- [ ] Have at least one person who self-identifies with ADHD review all decomposition responses before launch

### User Acceptance Testing

- [ ] Recruit minimum 5 beta users for structured UAT session (SRS 8.2)
- [ ] UAT covers: onboarding, morning briefing quality, task decomposition (3 task types), memory recall
- [ ] Measure: response time, tone rating (1–5 shame-free scale), decomposition usefulness (1–5)

---

## 🚀 Phase 10 — Beta Launch (Week 5–8)

- [ ] Recruit 30–50 beta users from Reddit and Facebook ADHD communities (PRD 8)
- [ ] Set up feedback collection mechanism (survey or in-app NPS prompt)
- [ ] Schedule weekly personal feedback calls with all beta users
- [ ] Monitor D7 retention (target ≥ 50%) and D30 retention (target ≥ 35%)
- [ ] Track NPS score (target ≥ 40)
- [ ] Track sessions per user per week (target ≥ 4)
- [ ] Track task decomposition satisfaction (target ≥ 70% "actually helpful")
- [ ] Set up LLM monthly spend cap + alert at 80% of cap
- [ ] Set up alert when a user has not returned for 3+ days (manual team check-in)
- [ ] At end of Month 2: analyze retention data → go/no-go decision for Month 3 features

---

## 🔒 Security Checklist (Throughout)

- [ ] All data transmission over HTTPS / TLS 1.2+ (SEC-01)
- [ ] Memory data encrypted at rest (SEC-02)
- [ ] Session tokens expire after 30 days of inactivity (SEC-03)
- [ ] Never log full content of user messages to application logs (SEC-04)
- [ ] Privacy policy shown before first use (SEC-05)
- [ ] User data never used to train shared AI models without explicit opt-in (SEC-06)

---

## 📦 API Endpoints Checklist

- [ ] `POST /api/chat` — send message, returns streaming token response
- [ ] `GET /api/memory` — fetch all active memory items for user
- [ ] `DELETE /api/memory/:id` — soft-delete a memory item
- [ ] `GET /api/session/today` — get or create today's session (includes briefing_delivered + check-in state)

---

## ❌ Out of Scope for MVP (Do Not Build)

- WhatsApp / SMS delivery
- Evening capture ritual
- Body double mode
- Hyperfocus protection
- Calendar integration
- Voice note processing
- User analytics dashboard
- Family / B2B plans
- Native mobile app
