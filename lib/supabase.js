import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Demo mode is active when Supabase credentials are not configured
export const isDemoMode = !supabaseUrl || !supabaseAnonKey;

// Anon client — for client-side Realtime subscriptions
export const supabase = isDemoMode
    ? null
    : createClient(supabaseUrl, supabaseAnonKey);

if (!isDemoMode && !supabaseServiceKey) {
    console.warn('[Supabase] SUPABASE_SERVICE_ROLE_KEY is not set — falling back to anon key. RLS will block server-side operations.');
}

// Service-role client — for server-side API routes (bypasses RLS)
export const supabaseAdmin = isDemoMode
    ? null
    : createClient(supabaseUrl, supabaseServiceKey || supabaseAnonKey);

import { createServerClient as createSSRServerClient } from '@supabase/ssr';

/**
 * Create a Supabase client that reads auth session from cookies.
 * Use in API routes and middleware (server-side only).
 */
export function createSupabaseServerClient(request) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    return createSSRServerClient(supabaseUrl, supabaseKey, {
        cookies: {
            getAll() {
                return request.cookies.getAll();
            },
            setAll() {
                // Read-only in API routes — session refresh handled by middleware
            },
        },
    });
}
