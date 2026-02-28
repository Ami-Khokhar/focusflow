// GET /api/reminders — check for due reminders and check-ins
import { getDueReminders, markReminderSurfaced, getOrCreateSession } from '@/lib/db';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
        return Response.json({ error: 'Missing userId' }, { status: 400 });
    }

    // Check for due reminders
    const dueReminders = await getDueReminders(userId);

    // Mark each as surfaced so they don't fire again
    for (const reminder of dueReminders) {
        await markReminderSurfaced(userId, reminder.id);
    }

    // Check for due check-in
    const session = await getOrCreateSession(userId);
    const now = new Date().toISOString();
    const checkInDue = !!(session.check_in_due_at && session.check_in_due_at <= now);

    return Response.json({
        reminders: dueReminders,
        checkInDue,
    });
}
