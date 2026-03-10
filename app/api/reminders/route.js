import { getDueReminders, consumeDueCheckIn, markReminderSurfaced } from '@/lib/db';
import { createSupabaseServerClient, supabaseAdmin, isDemoMode } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);

        let userId;
        if (isDemoMode) {
            userId = searchParams.get('userId');
            if (!userId) {
                return new Response(JSON.stringify({ error: 'Missing userId' }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
        } else {
            const supabase = createSupabaseServerClient(request);
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
            const { data: appUser, error } = await supabaseAdmin
                .from('users').select('id').eq('auth_user_id', user.id).maybeSingle();
            if (error || !appUser) return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
            userId = appUser.id;
        }

        const dueReminders = await getDueReminders(userId);
        if (dueReminders.length > 0) {
            console.log(`[Reminders] Found ${dueReminders.length} due:`, dueReminders.map(r => ({ id: r.id, content: r.content, remind_at: r.remind_at })));
            // Mark as surfaced so they don't return on the next poll
            for (const r of dueReminders) {
                await markReminderSurfaced(userId, r.id);
            }
        }
        const checkInResult = await consumeDueCheckIn(userId);

        return new Response(JSON.stringify({
            reminders: dueReminders,
            checkInDue: !!checkInResult,
            checkInDueAt: checkInResult?.dueAt || null
        }), {
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        console.error('Reminders API error:', error);
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
