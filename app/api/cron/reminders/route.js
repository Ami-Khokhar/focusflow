// GET /api/cron/reminders — server-side cron job (runs every minute via Vercel Cron)
// Scans ALL users for due reminders and marks them as surfaced.
// The Supabase Realtime subscription on the client picks up the UPDATE event and
// displays the reminder instantly — no client-side polling needed.
import { getAllDueReminders, markReminderSurfaced } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET(request) {
    // Verify the request is coming from Vercel Cron (or an authorised caller)
    const authHeader = request.headers.get('authorization');
    if (
        process.env.CRON_SECRET &&
        authHeader !== `Bearer ${process.env.CRON_SECRET}`
    ) {
        return new Response('Unauthorized', { status: 401 });
    }

    try {
        const due = await getAllDueReminders();

        // Mark each reminder as surfaced — this triggers Supabase Realtime on the client
        for (const reminder of due) {
            await markReminderSurfaced(reminder.user_id, reminder.id);
        }

        return Response.json({ processed: due.length, ids: due.map((r) => r.id) });
    } catch (error) {
        console.error('Cron reminders error:', error);
        return new Response('Internal server error', { status: 500 });
    }
}
