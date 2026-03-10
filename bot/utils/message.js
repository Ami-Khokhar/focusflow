/**
 * Split a message into chunks that fit Telegram's 4096 character limit.
 * Splits at paragraph boundaries when possible.
 */
export function splitMessage(text, maxLength = 4096) {
    if (!text || text.length <= maxLength) return [text || ''];

    const parts = [];
    let remaining = text;

    while (remaining.length > maxLength) {
        // Try to split at a double newline (paragraph boundary)
        let splitIndex = remaining.lastIndexOf('\n\n', maxLength);

        // Fall back to single newline
        if (splitIndex <= 0) {
            splitIndex = remaining.lastIndexOf('\n', maxLength);
        }

        // Fall back to space
        if (splitIndex <= 0) {
            splitIndex = remaining.lastIndexOf(' ', maxLength);
        }

        // Last resort: hard cut
        if (splitIndex <= 0) {
            splitIndex = maxLength;
        }

        parts.push(remaining.slice(0, splitIndex));
        remaining = remaining.slice(splitIndex).trimStart();
    }

    if (remaining) parts.push(remaining);
    return parts;
}
