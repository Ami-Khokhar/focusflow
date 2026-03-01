// POST /api/user — create or fetch a user
import { createUser, getUser } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(request) {
    try {
        const { displayName, timezone } = await request.json();
        const user = await createUser(displayName || 'Friend', timezone || null);
        return new Response(JSON.stringify(user), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        console.error('User API error:', error);
        return new Response(JSON.stringify({ error: 'Failed to create user' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const userId = searchParams.get('userId');
        if (!userId) {
            return new Response(JSON.stringify({ error: 'Missing userId' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }
        const user = await getUser(userId);
        if (!user) {
            return new Response(JSON.stringify({ error: 'User not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
            });
        }
        return new Response(JSON.stringify(user), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        console.error('User GET error:', error);
        return new Response(JSON.stringify({ error: 'Internal server error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
