// GET /api/reminders — check for due reminders and check-ins
// Also sends Web Push notifications to all subscribed devices for this user.
import webpush from 'web-push';
import { getDueReminders, markReminderSurfaced, getOrCreateSession, getPushSubscriptions, deletePushSubscription } from '@/lib/db';

// Configure VAPID for Web Push
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
        `mailto:${process.env.VAPID_EMAIL || 'noreply@focusflow.app'}`,
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY,
    );
}

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

    // Send Web Push for each due reminder to all of this user's subscribed devices
    if (dueReminders.length > 0 && process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
        const subs = await getPushSubscriptions(userId);
        for (const reminder of dueReminders) {
            for (const sub of subs) {
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

    // Check for due check-in
    const session = await getOrCreateSession(userId);
    const now = new Date().toISOString();
    const checkInDue = !!(session.check_in_due_at && session.check_in_due_at <= now);

    return Response.json({
        reminders: dueReminders,
        checkInDue,
    });
}
