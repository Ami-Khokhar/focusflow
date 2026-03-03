// GET /api/cron/reminders — server-side cron (Vercel + external cron-job.org)
// Scans ALL users for due reminders, marks them surfaced, and sends Web Push.
// Called by Vercel Cron (once/day) + cron-job.org (every 1 min) for always-on delivery.
import webpush from 'web-push';
import { getAllDueReminders, markReminderSurfaced, getPushSubscriptionsForUsers, deletePushSubscription } from '@/lib/db';

export const runtime = 'nodejs';

// Configure VAPID — required for Web Push
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
        `mailto:${process.env.VAPID_EMAIL || 'noreply@focusflow.app'}`,
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY,
    );
}

export async function GET(request) {
    // Verify the request is coming from Vercel Cron or cron-job.org
    const authHeader = request.headers.get('authorization');
    if (
        process.env.CRON_SECRET &&
        authHeader !== `Bearer ${process.env.CRON_SECRET}`
    ) {
        console.error('[cron] Auth failed — got:', authHeader, '— expected Bearer <CRON_SECRET>. If this is from cron-job.org, check Vercel Deployment Protection settings.');
        return new Response('Unauthorized', { status: 401 });
    }

    try {
        const due = await getAllDueReminders();
        if (due.length === 0) return Response.json({ processed: 0 });

        // Mark each reminder as surfaced — triggers Supabase Realtime on open tabs
        for (const reminder of due) {
            await markReminderSurfaced(reminder.user_id, reminder.id);
        }

        // Send Web Push to all subscribed devices for affected users
        if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
            const userIds = [...new Set(due.map((r) => r.user_id))];
            const subs = await getPushSubscriptionsForUsers(userIds);

            const subsByUser = {};
            for (const sub of subs) {
                if (!subsByUser[sub.user_id]) subsByUser[sub.user_id] = [];
                subsByUser[sub.user_id].push(sub);
            }

            for (const reminder of due) {
                const userSubs = subsByUser[reminder.user_id] || [];
                for (const sub of userSubs) {
                    try {
                        await webpush.sendNotification(
                            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                            JSON.stringify({
                                title: 'FocusFlow Reminder',
                                body: reminder.content,
                                url: '/chat',
                            })
                        );
                    } catch (err) {
                        if (err.statusCode === 410) {
                            await deletePushSubscription(sub.endpoint);
                        }
                    }
                }
            }
        }

        return Response.json({ processed: due.length, ids: due.map((r) => r.id) });
    } catch (error) {
        console.error('Cron reminders error:', error);
        return new Response('Internal server error', { status: 500 });
    }
}
