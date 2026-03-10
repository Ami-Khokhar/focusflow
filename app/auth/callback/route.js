// GET /auth/callback — Supabase OAuth callback handler
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');

    if (!code) {
        return NextResponse.redirect(new URL('/?error=no_code', request.url));
    }

    const cookieStore = await cookies();
    let redirectUrl = new URL('/chat', request.url);

    // Collect cookies to set on the final response
    const cookiesToReturn = [];

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        {
            cookies: {
                getAll() { return cookieStore.getAll(); },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value, options }) => {
                        cookieStore.set(name, value, options);
                        cookiesToReturn.push({ name, value, options });
                    });
                },
            },
        }
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
        console.error('[auth/callback] exchangeCodeForSession error:', error.message);
        redirectUrl = new URL('/?error=auth_failed', request.url);
    } else {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            redirectUrl = new URL('/?error=no_user', request.url);
        } else {
            // Check if we already have an app user linked to this auth account
            const { supabaseAdmin } = await import('@/lib/supabase');
            const { data: existingUser } = await supabaseAdmin
                .from('users')
                .select('id')
                .eq('auth_user_id', user.id)
                .maybeSingle();

            if (!existingUser) {
                const displayName = user.user_metadata?.full_name ||
                    user.user_metadata?.name ||
                    user.email?.split('@')[0] || 'Friend';
                await supabaseAdmin.from('users').insert({
                    display_name: displayName,
                    timezone: null,
                    auth_user_id: user.id,
                    onboarding_step: 0,
                });
            }
        }
    }

    const response = NextResponse.redirect(redirectUrl);
    cookiesToReturn.forEach(({ name, value, options }) => {
        response.cookies.set(name, value, options);
    });
    return response;
}
