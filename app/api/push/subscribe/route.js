// POST /api/push/subscribe — save a browser push subscription
// DELETE /api/push/subscribe — remove a push subscription (unsubscribe)
import { savePushSubscription, deletePushSubscription } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(request) {
    try {
        const { userId, subscription } = await request.json();
        if (!userId || !subscription?.endpoint || !subscription?.keys) {
            return Response.json({ error: 'Missing userId or subscription' }, { status: 400 });
        }
        await savePushSubscription(userId, subscription);
        return Response.json({ ok: true });
    } catch (error) {
        console.error('Push subscribe error:', error);
        return Response.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function DELETE(request) {
    try {
        const { endpoint } = await request.json();
        if (!endpoint) {
            return Response.json({ error: 'Missing endpoint' }, { status: 400 });
        }
        await deletePushSubscription(endpoint);
        return Response.json({ ok: true });
    } catch (error) {
        console.error('Push unsubscribe error:', error);
        return Response.json({ error: 'Internal server error' }, { status: 500 });
    }
}
