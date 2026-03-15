// ────────────────────────────────────────────
//  FocusFlow — LangChain Prompt Templates
//  Flowy persona + forbidden word filter
// ────────────────────────────────────────────

export const FORBIDDEN_WORDS = [
    'easy', 'simple', 'just', 'obviously', 'clearly',
    'you should', 'you need to', 'you must',
    'overdue', 'missed', 'failed', 'late', 'behind',
    "don't forget", 'do not forget',
    'lazy', 'easily', 'distracted',
    'you promised', 'you said you would',
];

const FORBIDDEN_REPLACEMENTS = {
    easy: 'here is a starting point',
    simple: 'here is a starting point',
    just: '',
    'you should': 'one option is',
    'you need to': 'you could try',
    overdue: 'still on the list',
    missed: 'still available',
    failed: 'not completed yet',
    late: 'whenever you are ready',
    behind: 'at your own pace',
};

// Safe idioms that contain forbidden words but are fine to keep
const SAFE_IDIOMS = [
    'take it easy', 'go easy on yourself', 'easy on yourself',
    'take it simple', 'it\'s not that simple',
];

/**
 * Filter forbidden words from LLM output.
 */
export function filterForbiddenWords(text) {
    let cleaned = text;

    // Temporarily protect safe idioms by replacing with placeholders
    const idiomPlaceholders = [];
    for (const idiom of SAFE_IDIOMS) {
        const regex = new RegExp(idiom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        cleaned = cleaned.replace(regex, (match) => {
            const placeholder = `__IDIOM_${idiomPlaceholders.length}__`;
            idiomPlaceholders.push(match);
            return placeholder;
        });
    }

    for (const word of FORBIDDEN_WORDS) {
        const regex = new RegExp(`\\b${word}\\b`, 'gi');
        const replacement = FORBIDDEN_REPLACEMENTS[word.toLowerCase()] ?? '';
        cleaned = cleaned.replace(regex, replacement);
    }

    // Restore safe idioms
    for (let i = 0; i < idiomPlaceholders.length; i++) {
        cleaned = cleaned.replace(`__IDIOM_${i}__`, idiomPlaceholders[i]);
    }

    cleaned = cleaned.replace(/  +/g, ' ').trim();
    return cleaned;
}

/**
 * Build the system prompt for the LangChain agent.
 * No JSON format instructions — the model responds naturally and calls tools natively.
 */
export function buildSystemPrompt({
    userName,
    currentTime,
    timezone,
    memoryItems = [],
    activeCheckIn = false,
    checkInDueAt = null,
    mainFocus = null,
    biggestStruggle = null,
    modeContext = '',
    lastAssistantMessage = null,
}) {
    const memoryList = memoryItems.length > 0
        ? '\n\nBACKGROUND NOTES (PRIVATE CONTEXT — only reference a specific item when the user explicitly asks about their saved items. NEVER list or summarize these. NEVER mention the user\'s name, focus, or struggle from these notes unless directly relevant to what they\'re asking right now):\n' + memoryItems.map((i) => `- [${i.category}] ${i.content}${i.remind_at ? ` (reminder: ${i.remind_at})` : ''}`).join('\n')
        : '';

    const checkInNote = activeCheckIn
        ? `\n- An active check-in timer is running until ${new Date(checkInDueAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: timezone || undefined })}. Do NOT offer another check-in.`
        : '';

    return `You are Flowy — a warm, brief friend who gets ADHD brains. Never judge or push.

RULES:
1. Respond to the user's ACTUAL message. Greet greetings, answer questions, engage with their specific topic.
2. Acknowledge feelings ONCE, then move forward. Never loop on empathy.
3. Never repeat what you already said. Keep it short: 1-2 sentences for chat, more for tasks.
4. Never use: easy, simple, just, obviously, you should, overdue, failed, late, behind, lazy.
5. "okay"/"yes"/"sure" = agreement with YOUR last message. Act on it — don't ask them to repeat.

TOOL RULES:
When the user asks to do something (save, remind, forget, complete), DO IT immediately. No confirmation prompts. Use warm phrasing ("Done!", "Got it!") — not robotic ("I've set a reminder").
- save_memory: ONLY when user says "remind me", "remember", "save", "note". Never for feelings or chat.
  - Relative times ("in 5 min") → use minutes_from_now. Absolute times ("at 3pm") → use remind_at in ISO 8601.
  - Content must come from what the USER said. Never invent content.
- delete_memory: ONLY when user says "forget", "delete", "remove". "nvm"/"never mind" → delete immediately.
- reschedule_reminder: ONLY when user says "snooze", "push back", "reschedule".
- complete_task: ONLY when user says they finished/completed a task.
- set_checkin_timer: ONLY when user agrees to a check-in you offered.
- update_profile: During onboarding to save name, focus, struggle.
- NEVER call tools for emotional messages, casual chat, or general questions.
- NEVER say "I've saved/noted that" unless you actually called a tool.
${lastAssistantMessage ? `\nYOUR LAST MESSAGE (do NOT repeat): "${lastAssistantMessage.slice(0, 200)}"` : ''}

USER: ${userName} | ${currentTime} (${timezone})${mainFocus ? ` | Focus: ${mainFocus}` : ''}${biggestStruggle ? ` | Struggle: ${biggestStruggle}` : ''}${checkInNote}${memoryList}${modeContext ? '\n\n' + modeContext : ''}`.trim();
}
