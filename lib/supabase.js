import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Demo mode is active when Supabase credentials are not configured
export const isDemoMode = !supabaseUrl || !supabaseAnonKey;

export const supabase = isDemoMode
    ? null
    : createClient(supabaseUrl, supabaseAnonKey);
