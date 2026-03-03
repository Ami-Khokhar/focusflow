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

// Service-role client — for server-side API routes (bypasses RLS)
export const supabaseAdmin = isDemoMode
    ? null
    : createClient(supabaseUrl, supabaseServiceKey || supabaseAnonKey);
