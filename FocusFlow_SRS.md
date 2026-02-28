# FocusFlow — Software Requirements Specification
**MVP · Chatbot Interface · Version 1.0 · Confidential · 2026**

---

## 1. Introduction

### 1.1 Purpose

This Software Requirements Specification (SRS) defines the functional, non-functional, and system requirements for the FocusFlow MVP — a web-based AI chatbot interface for adults with ADHD. This document is intended for use by the engineering team to build the system and serves as the contractual baseline for what the MVP must deliver.

### 1.2 Scope

The FocusFlow MVP is a single-page web application that hosts a conversational AI agent. The system must support four core interaction flows: morning briefing generation, task decomposition, passive memory capture, and shame-free check-ins. The MVP explicitly excludes proactive push messaging (WhatsApp, SMS, email) and native mobile apps.

### 1.3 Document Conventions

| Keyword | Meaning |
|---|---|
| SHALL | Mandatory requirement — must be implemented |
| SHOULD | Recommended — implement if feasible within MVP scope |
| MAY | Optional — nice to have, not required |
| P0 | Must ship — blocks release |
| P1 | Should ship — high value, not blocking |
| P2 | Nice to have — deferred if time-constrained |

### 1.4 References

- FocusFlow Product Proposal v1.0
- FocusFlow Product Requirements Document v1.0
- ADHD neuroscience literature on shame cycles, task initiation, and executive function

---

## 2. System Overview

### 2.1 System Context

FocusFlow MVP is a client-server web application. The client is a browser-based chat UI. The server hosts session management, persistent memory storage, and an LLM API integration layer. The system relies on a third-party LLM (e.g., Claude or GPT-4 class) for natural language generation.

### 2.2 Major Components

| Component | Description |
|---|---|
| Chat UI | Single-page React or Next.js frontend, mobile-responsive, no app install required |
| Session Manager | Handles user authentication (email or magic link), session state, and continuity |
| Memory Store | Persistent key-value or document store for user tasks, captured items, and interaction history |
| LLM Integration Layer | Prompting engine, context assembly, and API calls to chosen LLM provider |
| Prompt Engine | System prompts, persona configuration, and ADHD-specific tone guidelines |

### 2.3 Technology Constraints

- **Frontend:** React or Next.js (recommended) — must work on Chrome mobile browser without app install
- **Backend:** Node.js or Python — engineering team's discretion
- **Database:** Any persistent store (PostgreSQL, Supabase, Firebase, or similar)
- **LLM:** Claude (Anthropic) or GPT-4 class model via API — not local/self-hosted
- **Hosting:** Any cloud provider — must support HTTPS

---

## 3. Functional Requirements

### 3.1 User Authentication

| ID | Category | Requirement | Priority |
|---|---|---|---|
| AUTH-01 | Authentication | System SHALL support email-based magic link login — no password required | P0 |
| AUTH-02 | Authentication | System SHALL persist user identity across sessions using a secure token | P0 |
| AUTH-03 | Authentication | System SHALL associate all memory and history with the authenticated user | P0 |
| AUTH-04 | Authentication | System SHOULD allow users to set a display name used by the agent for personalization | P1 |

### 3.2 Morning Briefing

| ID | Category | Requirement | Priority |
|---|---|---|---|
| BRIEF-01 | Morning Briefing | When a user opens the chat between 05:00–12:00 local time and has not yet had a morning briefing that day, the agent SHALL proactively send a morning briefing as the first message | P0 |
| BRIEF-02 | Morning Briefing | The morning briefing SHALL include a warm greeting, the current date, and no more than 3 prioritized tasks | P0 |
| BRIEF-03 | Morning Briefing | The morning briefing SHALL end with an offer to help the user start the first task immediately | P0 |
| BRIEF-04 | Morning Briefing | If the user has no stored tasks, the briefing SHALL ask one question: "What is the most important thing you need to do today?" | P0 |
| BRIEF-05 | Morning Briefing | System SHALL mark a briefing as delivered and not repeat it if the user reopens the chat within the same day | P0 |
| BRIEF-06 | Morning Briefing | Task prioritization SHOULD consider recency of capture and any user-supplied urgency signals | P1 |

### 3.3 Task Decomposition

| ID | Category | Requirement | Priority |
|---|---|---|---|
| DECOMP-01 | Task Decomposition | When a user describes a task they are stuck on, the agent SHALL decompose it into a single concrete, immediately-actionable first step | P0 |
| DECOMP-02 | Task Decomposition | If the task description is ambiguous, the agent SHALL ask exactly one clarifying question before decomposing | P0 |
| DECOMP-03 | Task Decomposition | After providing the first step, the agent SHALL ask: "Want me to check in with you in 25 minutes?" | P0 |
| DECOMP-04 | Task Decomposition | If the user confirms a check-in, the system SHALL set a 25-minute in-session timer and send a follow-up message when the user is next active after the timer expires | P0 |
| DECOMP-05 | Task Decomposition | If the user returns still stuck after decomposition, the agent SHALL go smaller — offering a first step that takes under 2 minutes — never expressing judgment | P0 |
| DECOMP-06 | Task Decomposition | The agent SHALL never use the words "easy", "simple", "just", or "obviously" when describing task steps | P0 |

### 3.4 Memory Capture

| ID | Category | Requirement | Priority |
|---|---|---|---|
| MEM-01 | Memory | The agent SHALL acknowledge every item the user sends with a confirmation of what it understood | P0 |
| MEM-02 | Memory | All captured items SHALL be persisted to the user's memory store and survive browser refresh and new sessions | P0 |
| MEM-03 | Memory | When the user asks "what have I told you?" or similar, the agent SHALL return a readable summary of all stored items grouped by type (tasks, notes, links, ideas) | P0 |
| MEM-04 | Memory | Captured items SHALL be evaluated during morning briefing generation for inclusion if relevant to the current day | P0 |
| MEM-05 | Memory | Users SHALL be able to say "forget that" or "delete that last thing" to remove the most recently captured item | P1 |
| MEM-06 | Memory | The system SHOULD auto-categorize captured items as: Task, Reminder, Note, Idea, or Link | P1 |

### 3.5 Shame-Free Check-Ins

| ID | Category | Requirement | Priority |
|---|---|---|---|
| CHECK-01 | Check-In | When a task session is active (user confirmed they are starting a task) and 25 minutes of inactivity have passed, the agent SHALL send a check-in message upon the user's next interaction | P0 |
| CHECK-02 | Check-In | Check-in messages SHALL be warm and neutral — never include urgency, negative framing, or the words: overdue, missed, failed, late, or behind | P0 |
| CHECK-03 | Check-In | If the user reports distraction or non-completion, the agent SHALL respond with acceptance and offer to reschedule the task — no follow-up guilt | P0 |
| CHECK-04 | Check-In | Check-in messages SHOULD include a light, optional prompt: "Want to try a 5-minute version instead?" | P1 |
| CHECK-05 | Check-In | System SHALL only trigger check-ins when user has explicitly started a task session — never speculatively | P0 |

### 3.6 General Conversation

| ID | Category | Requirement | Priority |
|---|---|---|---|
| CONV-01 | Conversation | The agent SHALL maintain conversational context for the full session (minimum last 20 messages) | P0 |
| CONV-02 | Conversation | The agent SHALL be able to answer questions about ADHD management in a supportive, informational tone | P1 |
| CONV-03 | Conversation | The agent SHALL gracefully handle off-topic messages without breaking character or confusing the user | P0 |
| CONV-04 | Conversation | The system SHALL display a typing indicator when the LLM is generating a response | P0 |
| CONV-05 | Conversation | All agent messages SHALL be rendered with markdown support (bold, lists, line breaks) | P1 |

---

## 4. Non-Functional Requirements

### 4.1 Performance

| ID | Category | Requirement | Priority |
|---|---|---|---|
| PERF-01 | Performance | Agent response SHALL appear within 5 seconds of user message submission under normal conditions | P0 |
| PERF-02 | Performance | Morning briefing SHALL generate within 8 seconds of session start | P0 |
| PERF-03 | Performance | UI SHALL be interactive within 3 seconds on a 4G mobile connection | P0 |
| PERF-04 | Performance | System SHOULD stream LLM responses token-by-token to reduce perceived latency | P1 |

### 4.2 Security & Privacy

| ID | Category | Requirement | Priority |
|---|---|---|---|
| SEC-01 | Security | All data transmission SHALL use HTTPS/TLS 1.2 or higher | P0 |
| SEC-02 | Security | User memory data SHALL be stored encrypted at rest | P0 |
| SEC-03 | Security | Session tokens SHALL expire after 30 days of inactivity | P0 |
| SEC-04 | Security | System SHALL never log the full content of user messages to application logs | P0 |
| SEC-05 | Privacy | A privacy policy SHALL be presented to users before first use, explaining how conversation data is used | P0 |
| SEC-06 | Privacy | User data SHALL NOT be used to train any shared AI model without explicit opt-in consent | P0 |

### 4.3 Usability

| ID | Category | Requirement | Priority |
|---|---|---|---|
| UX-01 | Usability | The chat interface SHALL be fully functional on a mobile browser screen (375px minimum width) without horizontal scrolling | P0 |
| UX-02 | Usability | Font size for all body text SHALL be minimum 16px on mobile to ensure readability | P0 |
| UX-03 | Usability | The text input field SHALL remain anchored to the bottom of the viewport on mobile | P0 |
| UX-04 | Usability | Chat history SHALL be scrollable and agent messages SHALL be visually distinct from user messages | P0 |
| UX-05 | Usability | First-time users SHALL be shown a brief onboarding message (3 sentences max) explaining what FocusFlow does and how to get started | P0 |

### 4.4 Reliability

| ID | Category | Requirement | Priority |
|---|---|---|---|
| REL-01 | Reliability | System SHALL maintain 99% uptime during beta period (8 weeks) | P0 |
| REL-02 | Reliability | If LLM API call fails, system SHALL display a friendly error message and offer to retry — never show a raw error | P0 |
| REL-03 | Reliability | User memory data SHALL be backed up daily with minimum 7-day retention | P0 |

---

## 5. AI Agent Persona Specification

> **CRITICAL:** This section is as important as any technical requirement. The tone and persona of the agent is the product. Engineering must work with the prompt engineer to ensure these requirements are satisfied and validated with real users.

### 5.1 Tone Requirements

- **Warm and direct** — like a supportive friend who also happens to be organized
- **Never condescending** — assume the user is intelligent and capable
- **Shame-free at all times** — a missed task is always reschedulable, never a failure
- **Concise** — ADHD users lose attention. Responses should be under 100 words unless decomposing a complex task
- **Never preachy** — no unsolicited advice about ADHD management

### 5.2 Forbidden Words and Phrases

| Forbidden | Why | Use Instead |
|---|---|---|
| Easy / Simple / Just | Minimizes the user's experience of difficulty | "Here is a starting point" |
| You should / You need to | Prescriptive, triggers resistance | "One option is..." / "Want to try..." |
| Overdue / Missed / Failed | Creates shame, the opposite of the product's purpose | "Still on the list" / "Want to reschedule?" |
| Don't forget | Implies the user is likely to fail | "As a reminder..." / "Whenever you are ready..." |
| Lazy / Distracted | Pathologizing normal ADHD behavior | Never reference character or effort |
| You promised / You said you would | Guilt-tripping — antithetical to the product | Neutral restatement of the task |

### 5.3 System Prompt Requirements

- System prompt SHALL include a detailed persona definition including the tone guidelines above
- System prompt SHALL include the user's name, current time, and timezone
- System prompt SHALL include a structured representation of the user's current task list and recent captures
- System prompt SHALL include the interaction mode context (morning briefing, task decomposition, general chat)
- System prompt length SHOULD be kept under 2000 tokens to preserve context window for conversation history

---

## 6. Data Model

### 6.1 User

| Field | Description |
|---|---|
| id | UUID — primary key |
| email | String — unique, used for magic link auth |
| display_name | String — optional, used by agent for personalization |
| timezone | String — IANA timezone (e.g., Asia/Kolkata), auto-detected or user-set |
| created_at | Timestamp |
| last_active_at | Timestamp |

### 6.2 Memory Item

| Field | Description |
|---|---|
| id | UUID — primary key |
| user_id | UUID — foreign key to User |
| content | Text — raw content as captured from user message |
| category | Enum — Task \| Reminder \| Note \| Idea \| Link |
| status | Enum — Active \| Completed \| Archived |
| captured_at | Timestamp |
| surfaced_at | Timestamp — last time this item appeared in a briefing |

### 6.3 Session

| Field | Description |
|---|---|
| id | UUID — primary key |
| user_id | UUID — foreign key to User |
| started_at | Timestamp |
| briefing_delivered | Boolean — whether morning briefing was sent this session day |
| active_task_id | UUID nullable — currently active check-in task |
| check_in_due_at | Timestamp nullable — when check-in should trigger |

### 6.4 Message

| Field | Description |
|---|---|
| id | UUID — primary key |
| session_id | UUID — foreign key to Session |
| role | Enum — user \| assistant |
| content | Text — message content |
| created_at | Timestamp |

---

## 7. Key API Contracts

### 7.1 Send Message

**`POST /api/chat`**

| Field | Type | Description |
|---|---|---|
| message | string | User's message text |
| session_id | string (UUID) | Current session identifier |

**Response:** `200 OK` — Streaming `text/event-stream` of agent response tokens, or JSON with full response if streaming disabled.

### 7.2 Get Memory

**`GET /api/memory`**

Returns all active memory items for the authenticated user, sorted by `captured_at` descending.

### 7.3 Delete Memory Item

**`DELETE /api/memory/:id`**

Soft-deletes (archives) a memory item. Agent confirms deletion in the chat.

### 7.4 Get Session

**`GET /api/session/today`**

Returns or creates today's session for the authenticated user, including `briefing_delivered` status and any active check-in timer.

---

## 8. Testing Requirements

### 8.1 Functional Testing

- All P0 functional requirements SHALL have at least one automated integration test
- Morning briefing logic SHALL be tested with mock time to cover edge cases (boundary of 12:00, already delivered, no tasks)
- Memory persistence SHALL be tested across simulated session resets
- Forbidden word list SHALL have an automated check against a representative set of LLM responses (snapshot testing)

### 8.2 User Acceptance Testing

- Minimum 5 beta users SHALL complete a structured UAT session before public beta launch
- UAT SHALL cover: first-time onboarding, morning briefing quality, task decomposition for 3 different task types, and memory recall
- UAT SHALL measure: response time (perceived), tone rating (1–5 shame-free scale), and task decomposition usefulness (1–5)

### 8.3 Prompt Quality Testing

- Before launch, the prompt engineer SHALL evaluate 50 agent responses across all 4 feature flows against the tone requirements in section 5
- Any response that includes a forbidden word or phrase SHALL be treated as a P0 bug
- Decomposition responses SHALL be reviewed by at least one person who self-identifies with ADHD before launch

---

## 9. Deployment & Operations

### 9.1 Environments

| Environment | Description |
|---|---|
| Development | Local developer machines, shared dev DB, no rate limiting |
| Staging | Cloud-hosted mirror of production, used for UAT and QA |
| Production | Live environment — beta users only in Month 1–2 |

### 9.2 Monitoring

- System SHALL log LLM API latency, error rates, and token usage per request
- System SHALL alert on LLM error rate > 2% over a 5-minute window
- System SHALL track daily active users and session count for retention monitoring
- System SHOULD alert when a user has not returned for 3+ days (triggers manual check-in from team)

### 9.3 LLM Cost Management

- System SHOULD cache morning briefing content for 1 hour to reduce redundant LLM calls
- Context window sent to LLM SHALL be capped at last 20 messages + system prompt to control token costs
- Team SHOULD set a hard monthly LLM spend cap and alert at 80% of cap

---

## Appendix A: Glossary

| Term | Definition |
|---|---|
| ADHD | Attention Deficit Hyperactivity Disorder — a neurodevelopmental condition affecting executive function |
| Task initiation paralysis | The ADHD-specific experience of knowing what to do but being unable to start |
| Shame cycle | The pattern where failing to use a productivity tool causes shame, which makes future use even less likely |
| Body doubling | An ADHD management technique where having another person present (physically or virtually) helps with task completion |
| Object permanence | In ADHD context, the tendency for tasks and reminders to cease to exist psychologically when not in view |
| LLM | Large Language Model — the AI model powering the conversational agent |
| Magic link | A passwordless authentication method where a one-time login link is sent to the user's email |
