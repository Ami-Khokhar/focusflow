import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function GET() {
    const cookieStore = await cookies();
    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        {
            cookies: {
                getAll() { return cookieStore.getAll(); },
                setAll() {},
            },
        }
    );

    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
        return Response.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const displayName = user.user_metadata?.full_name ||
        user.user_metadata?.name ||
        user.email?.split('@')[0] || 'Friend';

    return Response.json({ id: user.id, display_name: displayName });
}
