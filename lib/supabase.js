const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Demo mode is active when Supabase credentials are not configured
export const isDemoMode = !supabaseUrl || !supabaseAnonKey;

let supabase = null;

// Only import Supabase SDK when credentials are configured
if (!isDemoMode) {
    const { createClient } = await import('@supabase/supabase-js');
    supabase = createClient(supabaseUrl, supabaseAnonKey);
}

export { supabase };
