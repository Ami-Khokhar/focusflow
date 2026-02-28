// GET /api/session — get or create today's session
import { getOrCreateSession, getMessages } from '@/lib/db';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
        return Response.json({ error: 'Missing userId' }, { status: 400 });
    }

    const session = await getOrCreateSession(userId);

    // Also fetch existing messages for this session
    const messages = await getMessages(session.id, 50);

    return Response.json({
        ...session,
        messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
        })),
    });
}
