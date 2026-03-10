'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function LandingPage() {
    const [loading, setLoading] = useState(false);
    const router = useRouter();

    useEffect(() => {
        fetch('/api/user/me').then(res => {
            if (res.ok) router.push('/chat');
        }).catch(() => {});
    }, [router]);

    async function handleLogin(provider) {
        setLoading(true);
        try {
            const { createBrowserClient } = await import('@supabase/ssr');
            const client = createBrowserClient(
                process.env.NEXT_PUBLIC_SUPABASE_URL,
                process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
            );
            await client.auth.signInWithOAuth({
                provider,
                options: {
                    redirectTo: `${window.location.origin}/auth/callback`,
                },
            });
        } catch {
            setLoading(false);
        }
    }

    return (
        <main className="landing-container">
            {/* Soft background glow */}
            <div className="landing-glow" />

            <section className="hero">
                <div className="header-meta">Flowy v1.0</div>
                <div className="landing-logo-container">
                    <img src="/logo.png" alt="Flowy Logo" className="landing-logo-large" />
                </div>
                <h1 className="hero-title">Peace of mind for the <span className="text-accent">neurodivergent</span> mind.</h1>
                <p className="hero-subtitle">
                    Flowy is a shame-free AI companion designed for adults with ADHD.
                    Start tasks with ease, capture memories instantly, and navigate your day without the pressure of typical productivity tools.
                </p>
                <div className="auth-buttons" style={{ display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center' }}>
                    <button className="btn-primary-large" onClick={() => handleLogin('google')} disabled={loading}>
                        {loading ? 'Redirecting...' : '🌐 Continue with Google'}
                    </button>
                </div>
            </section>

            <section className="features-grid">
                <div className="feature-card">
                    <div className="feature-icon">🌅</div>
                    <h3 className="feature-title">Golden Hour Briefing</h3>
                    <p className="feature-text">Start with three essential focal points. No scrolling, no noise — pure clarity.</p>
                </div>
                <div className="feature-card">
                    <div className="feature-icon">🧩</div>
                    <h3 className="feature-title">Tiny First Steps</h3>
                    <p className="feature-text">Paralyzed by a big task? We break it down into a single, two-minute action.</p>
                </div>
                <div className="feature-card">
                    <div className="feature-icon">🔍</div>
                    <h3 className="feature-title">Thought Capture</h3>
                    <p className="feature-text">A safe space to offload ideas and reminders. We hold them so you can breathe.</p>
                </div>
                <div className="feature-card">
                    <div className="feature-icon">💛</div>
                    <h3 className="feature-title">Kind Boundaries</h3>
                    <p className="feature-text">Gentle check-ins that respect your energy. No guilt trips, just support.</p>
                </div>
            </section>

            <footer className="landing-footer">
                <p className="privacy-badge">🔒 Your data is private and never used for training.</p>
                <div className="footer-links">
                    <a href="#">Privacy</a>
                    <a href="#">Ethics</a>
                    <a href="#">Contact</a>
                </div>
            </footer>
        </main>
    );
}
