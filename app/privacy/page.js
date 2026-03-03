export default function PrivacyPage() {
    return (
        <div style={{
            maxWidth: '600px',
            margin: '60px auto',
            padding: '0 24px',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            color: '#e0e0e0',
            backgroundColor: '#1a1a2e',
            minHeight: '100vh',
            lineHeight: 1.7
        }}>
            <h1 style={{ fontSize: '1.5rem', marginBottom: '24px' }}>Privacy Policy</h1>

            <p style={{ marginBottom: '16px' }}>
                FocusFlow stores your display name, timezone, chat messages, and memory items
                (tasks, reminders, notes, ideas) in a secure database. Your messages are sent to
                the Groq API to generate responses — they are not stored by Groq beyond the request.
                We do not sell, share, or monetize your data. Period.
            </p>

            <p style={{ marginBottom: '24px' }}>
                Want your data deleted? Send a request and we will wipe everything — your account,
                messages, memories, all of it. No hoops, no waiting period. Your data is yours.
            </p>

            <a href="/chat" style={{ color: '#7c83ff', textDecoration: 'none' }}>
                ← Back to FocusFlow
            </a>
        </div>
    );
}
