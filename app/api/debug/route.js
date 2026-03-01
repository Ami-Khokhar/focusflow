// GET /api/debug — temporary env var check. DELETE THIS ROUTE after diagnosing.
export async function GET() {
    return Response.json({
        hasGroqKey: !!process.env.GROQ_API_KEY,
        groqKeyPrefix: process.env.GROQ_API_KEY?.slice(0, 8) ?? 'NOT SET',
        hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
        hasSupabaseKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        nodeEnv: process.env.NODE_ENV,
    });
}
