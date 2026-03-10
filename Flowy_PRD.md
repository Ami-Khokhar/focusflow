# FocusFlow — Product Requirements Document

**MVP · Chatbot Interface · Version 1.0 · Confidential · 2026**

---

## 1. Product Overview

FocusFlow is an AI-powered personal agent designed for adults with ADHD. The MVP is a web-based chatbot interface that validates the core AI logic and interaction model before investing in proactive delivery channels like WhatsApp.

> **MVP SCOPE:** The MVP intentionally trades the proactive delivery model (the long-term vision) for a zero-infrastructure chatbot that lets us validate whether the AI's tone, task decomposition quality, and memory capture are genuinely useful for ADHD users before spending on WhatsApp Business API costs.

### 1.1 Document Information

| Field | Value |
|---|---|
| Product Name | Flowy MVP |
| Document Type | Product Requirements Document (PRD) |
| Version | 1.0 |
| Target Release | Month 1–2 of Roadmap |
| Primary Audience | Engineering, Design, Beta Users |
| Status | Draft — Pending Engineering Review |

### 1.2 Goals of the MVP

The MVP has three explicit validation goals:

- **Validate AI quality:** Does the task decomposition, morning briefing, and shame-free tone actually resonate with ADHD users?
- **Validate retention signal:** Will users return to a passive chatbot daily, even without proactive nudges?
- **Validate product-market fit:** Can we recruit 30–50 beta users who call this meaningfully better than what they have tried before?

---

## 2. Problem Statement

### 2.1 Who We Are Building For

Adults with ADHD who have tried and abandoned multiple productivity systems. They are not lazy — they are burned out on tools that assume neurotypical executive function. Our target user:

- Has tried at least 3 productivity apps and abandoned all of them
- Self-identifies with ADHD (diagnosis not required)
- Is between 22–40 years old, urban, digitally literate
- Feels shame about their inability to maintain systems

### 2.2 Core Pain Points Addressed in MVP

| Pain Point | Description |
|---|---|
| Time blindness | No sense of how long tasks take or how much time has passed |
| Task initiation paralysis | Knowing what to do but being unable to start |
| Working memory gaps | Forgetting mid-task what the original goal was |
| Object permanence | Out of sight genuinely means out of mind for tasks and reminders |

---

## 3. User Personas

### 3.1 Primary Persona — Riya

| Field | Detail |
|---|---|
| Age / Location | 28, Bengaluru |
| Occupation | Product Manager at a startup |
| ADHD Status | Self-diagnosed, exploring formal diagnosis |
| Tools tried | Notion, Todoist, physical planners, Google Tasks — all abandoned within weeks |
| Core frustration | She sets up complex systems on weekends and forgets to use them by Tuesday |
| What she needs | Something that meets her where she is, does not require maintenance, and does not make her feel guilty when she slips |

### 3.2 Secondary Persona — Arjun

| Field | Detail |
|---|---|
| Age / Location | 34, Mumbai |
| Occupation | Freelance designer |
| ADHD Status | Formally diagnosed at 31 |
| Tools tried | Tried medication, coaches, and apps — uses nothing consistently |
| Core frustration | Large projects feel paralyzing. He cannot break them into steps on his own. |
| What he needs | A thought partner that breaks tasks down without judgment and checks in during work |

---

## 4. MVP Feature Set

The MVP includes exactly **four features**. Nothing else ships in v1.

### 4.1 Feature 1 — Morning Briefing

**What it does**

When the user opens the chatbot each morning, the agent proactively generates a warm, prioritized summary of the day. It surfaces only the 3 most important tasks — not everything — and immediately offers to help start the first one.

**Why it matters**

ADHD users experience decision paralysis when confronted with everything they need to do. Limiting to 3 items and offering immediate next steps removes the activation energy barrier.

**Acceptance Criteria**

- Agent greets user by name and acknowledges the time of day
- Surfaces exactly 3 prioritized tasks from memory, not a dump of everything
- Offers in the same message to help start the first task
- If no tasks exist yet, asks the user one question to capture the most important thing today

---

### 4.2 Feature 2 — Adaptive Task Decomposition

**What it does**

When a user describes a task they are stuck on, the agent breaks it into the smallest possible first step. Not "write the report" but "open a blank document and write one sentence about what the report is for."

**Why it matters**

Task initiation paralysis is caused by a task feeling too large or undefined. The smallest viable first step bypasses the paralysis because it feels achievable.

**Acceptance Criteria**

- Agent asks one clarifying question if the task is vague before decomposing
- Decomposition always ends with a single, concrete, immediately-actionable first step
- Agent asks "Want me to check in with you in 25 minutes?" after giving the first step
- If user returns saying they are still stuck, agent goes smaller — never judges

---

### 4.3 Feature 3 — Passive Memory Capture

**What it does**

Users can dump anything into the chat — a task, a thought, a link, a voice note transcript — and the agent files it, categorizes it, and surfaces it at the right moment. No manual organization required.

**Why it matters**

ADHD users have object permanence issues. If something is not in front of them, it does not exist. Memory capture removes the burden of maintaining a system.

**Acceptance Criteria**

- Agent acknowledges every capture immediately and confirms what it understood
- Captured items are surfaced in the morning briefing when relevant
- User can ask "what have I told you?" to get a summary of stored items
- Agent never loses a captured item between sessions

---

### 4.4 Feature 4 — Shame-Free Check-Ins

**What it does**

If a user starts a task and then goes quiet for 25 minutes, the agent sends a gentle message: "Hey — still on it? Totally fine if not, want to reschedule?" No red flags, no guilt.

**Why it matters**

Standard reminders create shame loops when dismissed. ADHD users need a system that resets without judgment — every time.

**Acceptance Criteria**

- Check-in language is always neutral and warm — no urgency, no negative framing
- If user says they got distracted, agent responds with "no problem" and offers to reschedule
- Agent never uses words like "overdue", "missed", "failed", or "late"
- Check-in only triggers after user explicitly starts a task session

---

## 5. Out of Scope for MVP

> **EXCLUDED:** The following features appear in the product proposal but are explicitly excluded from v1. They will be evaluated post-MVP based on retention and feedback data.

- WhatsApp or SMS delivery — no proactive outreach in MVP
- Evening capture ritual — may add in month 3–4
- Body double mode — deferred to month 3–4
- Hyperfocus protection — deferred to month 3–4
- Calendar integration (Google Calendar, etc.)
- Voice note processing
- User analytics dashboard
- Family plan or B2B features

---

## 6. Success Metrics

### 6.1 Primary Metrics (Month 1–2)

| Metric | Description | Target | Priority |
|---|---|---|---|
| D7 Retention | % of beta users who return on day 7 | >= 50% | P0 |
| D30 Retention | % of beta users active after 30 days | >= 35% | P0 |
| NPS Score | Net Promoter Score from beta survey | >= 40 | P0 |
| Task decomp satisfaction | % rating decomposition as "actually helpful" | >= 70% | P1 |
| Sessions per user per week | Avg weekly active sessions per user | >= 4 | P1 |

### 6.2 Qualitative Signals

In addition to quantitative metrics, we are looking for these qualitative signals from beta users:

- Unprompted referrals or sharing with other ADHD community members
- Users describing the tone as "different" or "actually gets me"
- Users returning after a gap without us sending them anything

---

## 7. Constraints & Assumptions

### 7.1 Constraints

- No WhatsApp Business API spend in MVP phase
- Solo or 2-person engineering team — keep the stack simple
- Must work on mobile browser without a native app
- All user data stored securely — ADHD users share sensitive personal information

### 7.2 Key Assumptions

- ADHD users will voluntarily open a chatbot daily if the value from each session is high enough
- The core differentiation is AI quality and tone — not the delivery channel
- Beta users recruited from ADHD communities will provide honest, detailed feedback

---

## 8. MVP Timeline

| Period | Milestone |
|---|---|
| Week 1–2 | Core chatbot interface, memory persistence, morning briefing logic |
| Week 3–4 | Task decomposition engine, shame-free check-in flow |
| Week 5 | Beta recruitment (target: 50 users from Reddit/Facebook ADHD groups) |
| Week 6–8 | Beta running, weekly feedback calls, iteration |
| End of Month 2 | Retention data analyzed, go/no-go for Month 3 features |

---

## 9. Risks

| Risk | Description | Likelihood | Mitigation |
|---|---|---|---|
| Low daily opens | Users forget to open the chatbot without proactive nudges | High | Email or browser notification as lightweight nudge |
| AI tone misses | Agent responses feel generic, not ADHD-specific | Medium | Extensive prompt engineering + user feedback loop in week 1 |
| Beta drop-off | Users engage once and never return | Medium | Weekly personal check-in calls with all 50 beta users |
| Privacy concern | Users hesitant to share daily life with AI | Low-Med | Be transparent about data use; start with low-stakes tasks |

---

## Appendix: Design Principles

Every feature decision must be evaluated against these five principles inherited from the full product vision:

- **They come to it** — in MVP: the briefing greets them when they arrive, minimizing the effort to get value
- **Value before effort** — user gets a useful response in the first 30 seconds, no lengthy setup
- **Shame-free always** — every word choice is warm, neutral, and judgment-free
- **Silence as signal** — if the user is not getting negative feedback, they are on track
- **Progressive trust** — start with the least invasive features and earn access to more personal context over time
