// POST /api/user — create or fetch a user
import { createUser, getUser } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(request) {
    try {
        const { displayName, timezone } = await request.json();
        const user = await createUser(displayName || 'Friend', timezone || null);
        return Response.json(user);
    } catch (error) {
        console.error('User API error:', error);
        return Response.json({ error: 'Failed to create user' }, { status: 500 });
    }
}

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const userId = searchParams.get('userId');
        if (!userId) {
            return Response.json({ error: 'Missing userId' }, { status: 400 });
        }
        const user = await getUser(userId);
        if (!user) {
            return Response.json({ error: 'User not found' }, { status: 404 });
        }
        return Response.json(user);
    } catch (error) {
        console.error('User GET error:', error);
        return Response.json({ error: 'Internal server error' }, { status: 500 });
    }
}
