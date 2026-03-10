/**
 * Convert markdown to Telegram-safe HTML.
 * Uses HTML parse_mode to avoid MarkdownV2 escaping nightmares.
 */
export function toTelegramHTML(text) {
    if (!text) return '';

    let html = text;

    // Escape HTML entities first (before we add our own tags)
    html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Code blocks (``` ... ```) → <pre>
    html = html.replace(/```[\w]*\n?([\s\S]*?)```/g, '<pre>$1</pre>');

    // Inline code (` ... `) → <code>
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Bold (**text** or __text__) → <b>
    html = html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    html = html.replace(/__(.+?)__/g, '<b>$1</b>');

    // Italic (*text* or _text_) — careful not to match inside words
    html = html.replace(/(?<!\w)\*([^*]+?)\*(?!\w)/g, '<i>$1</i>');
    html = html.replace(/(?<!\w)_([^_]+?)_(?!\w)/g, '<i>$1</i>');

    // Strikethrough (~~text~~) → <s>
    html = html.replace(/~~(.+?)~~/g, '<s>$1</s>');

    return html;
}
