// GET /api/debug — temporary env var check. DELETE THIS ROUTE after diagnosing.
export async function GET() {
    const key = process.env.GEMINI_API_KEY;
    let models = [];
    let modelsError = null;

    if (key) {
        try {
            const res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`
            );
            const data = await res.json();
            models = (data.models || []).map((m) => m.name);
        } catch (e) {
            modelsError = e.message;
        }
    }

    return Response.json({
        hasGeminiKey: !!key,
        geminiKeyPrefix: key?.slice(0, 8) ?? 'NOT SET',
        availableModels: models,
        modelsError,
        nodeEnv: process.env.NODE_ENV,
    });
}
