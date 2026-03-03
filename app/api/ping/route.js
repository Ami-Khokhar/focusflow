// GET /api/ping — public health check (no auth required)
// Use this to verify Vercel deployment protection is disabled and the app is reachable.
export async function GET() {
    return Response.json({ ok: true, ts: new Date().toISOString() });
}
