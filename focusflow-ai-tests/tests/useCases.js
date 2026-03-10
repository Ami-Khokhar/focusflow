/**
 * useCases.js - Variant message sets per deterministic scenario.
 * These preserve each scenario's expected behavior while broadening phrasing.
 */

export const scenarioUseCases = {
    memory_capture: [
        { id: 'baseline', message: 'remember to call mom' },
        { id: 'remind_to', message: 'remind me to call mom tonight' },
        { id: 'dont_forget', message: "don't let me forget to call mom" },
        { id: 'note_down', message: 'note this down call mom after lunch' },
    ],
    reminder_creation: [
        { id: 'baseline', message: 'remind me to send the email in 10 minutes' },
        { id: 'relative_later', message: 'set a reminder to send the email 10 minutes from now' },
        { id: 'informal', message: 'can you remind me about that email in 10 mins' },
        { id: 'mixed_case', message: 'Remind me to SEND the email in 10 minutes' },
    ],
    reminder_reschedule: [
        { id: 'baseline', message: 'actually push that back 30 minutes' },
        { id: 'snooze', message: 'snooze it 30 minutes' },
        { id: 'delay', message: 'delay that reminder by 30 mins' },
        { id: 'give_me', message: 'give me 30 more minutes on that reminder' },
    ],
    memory_recall: [
        { id: 'baseline', message: 'wait what was I supposed to do again? what do you remember?' },
        { id: 'direct', message: 'what do you remember right now' },
        { id: 'list_request', message: 'show me my notes and tasks' },
        { id: 'adhd_style', message: 'i forgot again, what have i told you' },
    ],
    decomposition: [
        { id: 'baseline', message: "I'm so overwhelmed with this project, I don't even know where to start" },
        { id: 'stuck_start', message: "i'm stuck and can't start this project at all" },
        { id: 'paralyzed', message: 'this task feels too big and i am freezing' },
        { id: 'need_first_step', message: 'help me start, i feel overwhelmed by this project' },
    ],
    task_complete: [
        { id: 'baseline', message: 'done!!' },
        { id: 'finished', message: 'i finished it' },
        { id: 'wrapped', message: 'wrapped it up' },
        { id: 'checked_off', message: 'checked it off' },
    ],
    check_in_acceptance: [
        { id: 'baseline', message: 'yes please set that timer' },
        { id: 'go_ahead', message: 'yeah go ahead set it' },
        { id: 'affirmative', message: 'sure set the 25 minute check in' },
        { id: 'short_yes', message: 'yes do it' },
    ],
    memory_delete: [
        { id: 'baseline', message: 'forget that actually' },
        { id: 'delete_last', message: 'delete that last thing' },
        { id: 'remove_last', message: 'remove the last note' },
        { id: 'undo_last', message: 'undo that memory' },
    ],
};

export function getScenarioUseCases(scenarioId) {
    return scenarioUseCases[scenarioId] || [];
}
