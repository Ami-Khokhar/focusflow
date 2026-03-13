import { z } from 'zod';

export const FlowyResponseSchema = z.object({
    message: z.string().describe("The conversational response to display to the user. Ask questions, validate feelings, or confirm actions."),
    tool_calls: z.array(z.object({
        name: z.string().describe("The exact name of the tool to call (e.g., save_memory, delete_memory, complete_task, reschedule_reminder, set_checkin_timer, update_profile)"),
        args: z.record(z.any()).describe("The arguments as a JSON object matching the tool's required schema")
    })).describe("A list of tools to execute behind the scenes. Max 3 tools per turn.").optional().default([])
});
