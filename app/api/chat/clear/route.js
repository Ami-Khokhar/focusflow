import { clearMessages } from '@/lib/db';
import { createSupabaseServerClient, supabaseAdmin, isDemoMode } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function POST(request) {
    try {
        const { sessionId, userId } = await request.json();

        if (!isDemoMode) {
            const supabase = createSupabaseServerClient(request);
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
            const { data: appUser } = await supabaseAdmin
                .from('users').select('id').eq('auth_user_id', user.id).maybeSingle();
            if (!appUser || appUser.id !== userId) return Response.json({ error: 'Unauthorized' }, { status: 401 });

            // Verify session belongs to this user
            const { data: session } = await supabaseAdmin
                .from('sessions').select('user_id').eq('id', sessionId).maybeSingle();
            if (!session || session.user_id !== appUser.id) {
                return Response.json({ error: 'Session not found' }, { status: 404 });
            }
        }

        if (!sessionId) return Response.json({ error: 'Missing sessionId' }, { status: 400 });
        await clearMessages(sessionId);
        return Response.json({ ok: true });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
}
