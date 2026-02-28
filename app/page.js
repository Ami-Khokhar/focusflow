'use client';

import { useRouter } from 'next/navigation';

export default function LandingPage() {
    const router = useRouter();

    function handleDemo() {
        localStorage.setItem('focusflow_user_id', '00000000-0000-0000-0000-000000000001');
        localStorage.setItem('focusflow_user_name', 'Friend');
        router.push('/chat');
    }

    return (
        <main className="landing">
            <div className="landing-logo">🧠</div>
            <h1>FocusFlow</h1>
            <p className="tagline">
                Your shame-free AI companion for ADHD. Start tasks, stay on track, and
                remember what matters — without pressure.
            </p>

            <div className="features">
                <div className="feature-card">
                    <div className="icon">🌅</div>
                    <h3>Morning Briefing</h3>
                    <p>3 priorities to start your day, no overwhelming lists</p>
                </div>
                <div className="feature-card">
                    <div className="icon">🧩</div>
                    <h3>Task Breakdown</h3>
                    <p>Stuck? Get one tiny, doable first step</p>
                </div>
                <div className="feature-card">
                    <div className="icon">🧠</div>
                    <h3>Memory Capture</h3>
                    <p>Dump anything — it remembers so you don't have to</p>
                </div>
                <div className="feature-card">
                    <div className="icon">💛</div>
                    <h3>Gentle Check-ins</h3>
                    <p>No guilt, no shame. Reschedule anytime.</p>
                </div>
            </div>

            <button className="btn-primary" onClick={handleDemo}>
                ✨ Try Demo
            </button>

            <p className="privacy-note">
                Your conversations stay private. No data is shared with third parties or
                used to train AI models. Read our{' '}
                <a href="#" style={{ color: 'var(--accent)' }}>
                    privacy policy
                </a>
                .
            </p>
        </main>
    );
}
