// GET /api/memory — fetch active memory items
// POST /api/memory — save a new memory item
import { getMemoryItems, saveMemoryItem, deleteMemoryItem, updateMemoryItem } from '@/lib/db';
import { createSupabaseServerClient, supabaseAdmin, isDemoMode } from '@/lib/supabase';

async function resolveUserId(request, bodyUserId) {
    if (isDemoMode) {
        return { userId: bodyUserId || null, error: null };
    }
    const supabase = createSupabaseServerClient(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { userId: null, error: Response.json({ error: 'Unauthorized' }, { status: 401 }) };
    const { data: appUser, error } = await supabaseAdmin
        .from('users').select('id').eq('auth_user_id', user.id).maybeSingle();
    if (error || !appUser) return { userId: null, error: Response.json({ error: 'User not found' }, { status: 404 }) };
    return { userId: appUser.id, error: null };
}

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const { userId, error } = await resolveUserId(request, searchParams.get('userId'));
    if (error) return error;
    if (!userId) return Response.json({ error: 'Missing userId' }, { status: 400 });

    try {
        const items = await getMemoryItems(userId);
        return Response.json(items);
    } catch (err) {
        console.error('Memory GET error:', err);
        return Response.json({ error: err.message }, { status: 500 });
    }
}

export async function POST(request) {
    const body = await request.json();
    const { content, category } = body;
    const { userId, error } = await resolveUserId(request, body.userId);
    if (error) return error;
    if (!userId || !content) {
        return Response.json({ error: 'Missing userId or content' }, { status: 400 });
    }

    try {
        const item = await saveMemoryItem(userId, content, category || 'Note');
        return Response.json(item);
    } catch (err) {
        console.error('Memory POST error:', err);
        return Response.json({ error: err.message }, { status: 500 });
    }
}

export async function PATCH(request) {
    const body = await request.json();
    const { id, action } = body;
    const { userId, error } = await resolveUserId(request, body.userId);
    if (error) return error;
    if (!userId || !id || !action) {
        return Response.json({ error: 'Missing userId, id, or action' }, { status: 400 });
    }

    try {
        let updates;
        if (action === 'keep_as_note') {
            updates = { category: 'Note', remind_at: null, surfaced_at: null };
        } else if (action === 'dismiss') {
            updates = { status: 'Archived' };
        } else {
            return Response.json({ error: 'Invalid action' }, { status: 400 });
        }
        const item = await updateMemoryItem(userId, id, updates);
        return Response.json(item);
    } catch (err) {
        console.error('Memory PATCH error:', err);
        return Response.json({ error: err.message }, { status: 500 });
    }
}

export async function DELETE(request) {
    const { searchParams } = new URL(request.url);
    const itemId = searchParams.get('id');
    const { userId, error } = await resolveUserId(request, searchParams.get('userId'));
    if (error) return error;
    if (!userId || !itemId) {
        return Response.json({ error: 'Missing userId or id' }, { status: 400 });
    }

    try {
        const item = await deleteMemoryItem(userId, itemId);
        if (!item) {
            return Response.json({ error: 'Not found' }, { status: 404 });
        }
        return Response.json(item);
    } catch (err) {
        console.error('Memory DELETE error:', err);
        return Response.json({ error: err.message }, { status: 500 });
    }
}
