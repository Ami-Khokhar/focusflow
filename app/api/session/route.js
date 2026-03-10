// GET /api/session — get or create today's session
import { getOrCreateSession, getMessages, getUser } from '@/lib/db';
import { createSupabaseServerClient, supabaseAdmin, isDemoMode } from '@/lib/supabase';

export async function GET(request) {
    const { searchParams } = new URL(request.url);

    let userId;
    if (isDemoMode) {
        userId = searchParams.get('userId');
        if (!userId) return Response.json({ error: 'Missing userId' }, { status: 400 });
    } else {
        const supabase = createSupabaseServerClient(request);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
        const { data: appUser, error } = await supabaseAdmin
            .from('users').select('id').eq('auth_user_id', user.id).maybeSingle();
        if (error || !appUser) return Response.json({ error: 'User not found' }, { status: 404 });
        userId = appUser.id;
    }

    try {
        const [session, user] = await Promise.all([
            getOrCreateSession(userId),
            getUser(userId),
        ]);

        // Also fetch existing messages for this session
        const messages = await getMessages(session.id, 50);

        return Response.json({
            ...session,
            onboarding_step: user?.onboarding_step ?? 0,
            display_name: user?.display_name || 'Friend',
            messages: messages.map((m) => ({
                role: m.role,
                content: m.content,
            })),
        });
    } catch (error) {
        console.error('Session API error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
}
