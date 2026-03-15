import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';

export async function middleware(request) {
    const { pathname } = request.nextUrl;

    // Always allow auth callback through
    if (pathname.startsWith('/auth/callback')) {
        return NextResponse.next();
    }

    // Pass through in demo mode (no Supabase configured)
    const hasSupabase = !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    if (!hasSupabase) return NextResponse.next();

    const response = NextResponse.next();

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        {
            cookies: {
                getAll() { return request.cookies.getAll(); },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value, options }) => {
                        request.cookies.set(name, value, options);
                        response.cookies.set(name, value, options);
                    });
                },
            },
        }
    );

    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        const authHeader = request.headers.get('authorization');

        // Allow cron routes through with valid CRON_SECRET
        if (pathname.startsWith('/api/cron') && authHeader === `Bearer ${process.env.CRON_SECRET}`) {
            return response;
        }

        // Allow test mode bypass with TEST_TOKEN (non-production only)
        if (
            process.env.NODE_ENV !== 'production' &&
            process.env.TEST_MODE === 'true' &&
            authHeader === `Bearer ${process.env.TEST_TOKEN}`
        ) {
            return response;
        }

        if (pathname.startsWith('/api') && !pathname.startsWith('/api/cron')) {
            console.log('[Middleware] Auth denied:', { pathname, authHeader, testMode: process.env.TEST_MODE });
        }

        // Redirect unauthenticated /chat visitors to landing
        if (pathname.startsWith('/chat')) {
            return NextResponse.redirect(new URL('/', request.url));
        }
        // Block unauthenticated API calls (let route handlers do their own auth check for polling endpoints)
        if (pathname.startsWith('/api') && !pathname.startsWith('/api/cron') && !pathname.startsWith('/api/reminders') && !pathname.startsWith('/api/telegram') && pathname !== '/api/ping') {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }
    }

    return response;
}

export const config = {
    matcher: ['/chat', '/chat/:path*', '/api/:path*'],
};
