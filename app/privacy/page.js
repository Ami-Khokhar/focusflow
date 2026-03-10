export default function PrivacyPage() {
    return (
        <main className="landing-container">
            <section className="hero">
                <h1 className="hero-title">Privacy at Flowy</h1>
                <p className="hero-subtitle">
                    Flowy is built on the principle of radical privacy.
                </p>

                <p style={{ marginBottom: '16px', color: 'var(--text-secondary)' }}>
                    Flowy stores your display name, timezone, chat messages, and memory items
                    (tasks, reminders, notes, ideas) in a secure database. Your messages are sent to
                    the Groq API to generate responses — they are not stored by Groq beyond the request.
                    We do not sell, share, or monetize your data. Period.
                </p>

                <p style={{ marginBottom: '24px', color: 'var(--text-secondary)' }}>
                    Want your data deleted? Send a request and we will wipe everything — your account,
                    messages, memories, all of it. No hoops, no waiting period. Your data is yours.
                </p>

                <a href="/chat" style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: '600' }}>
                    ← Back to Flowy
                </a>
            </section>
        </main>
    );
}
