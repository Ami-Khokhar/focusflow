// GET /api/memory — fetch active memory items
// POST /api/memory — save a new memory item
import { getMemoryItems, saveMemoryItem, deleteMemoryItem } from '@/lib/db';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
        return Response.json({ error: 'Missing userId' }, { status: 400 });
    }

    const items = await getMemoryItems(userId);
    return Response.json(items);
}

export async function POST(request) {
    const { userId, content, category } = await request.json();

    if (!userId || !content) {
        return Response.json({ error: 'Missing userId or content' }, { status: 400 });
    }

    const item = await saveMemoryItem(userId, content, category || 'Note');
    return Response.json(item);
}

export async function DELETE(request) {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const itemId = searchParams.get('id');

    if (!userId || !itemId) {
        return Response.json({ error: 'Missing userId or id' }, { status: 400 });
    }

    const item = await deleteMemoryItem(userId, itemId);
    return Response.json(item || { error: 'Not found' });
}
