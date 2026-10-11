import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Factory, Mail } from 'lucide-react';

const ParticleField = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const particles: { x: number; y: number; vx: number; vy: number; size: number; opacity: number }[] = [];
    for (let i = 0; i < 40; i++) {
      particles.push({ x: Math.random() * canvas.width, y: Math.random() * canvas.height, vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.3, size: Math.random() * 1.5 + 0.5, opacity: Math.random() * 0.4 + 0.1 });
    }
    let animId: number;
    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach((p, i) => {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
        if (p.y < 0 || p.y > canvas.height) p.vy *= -1;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(38, 92%, 50%, ${p.opacity})`; ctx.fill();
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[j].x - p.x, dy = particles[j].y - p.y, dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 100) { ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(particles[j].x, particles[j].y); ctx.strokeStyle = `hsla(38, 92%, 50%, ${0.05 * (1 - dist / 100)})`; ctx.lineWidth = 0.5; ctx.stroke(); }
        }
      });
      animId = requestAnimationFrame(animate);
    };
    animate();
    const handleResize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    window.addEventListener('resize', handleResize);
    return () => { cancelAnimationFrame(animId); window.removeEventListener('resize', handleResize); };
  }, []);
  return <canvas ref={canvasRef} className="absolute inset-0 z-0" />;
};

const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
    setLoading(false);
    if (error) { setError(error.message); } else { setSent(true); }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 relative overflow-hidden">
      <ParticleField />
      <div className="absolute top-1/2 -left-32 w-80 h-80 rounded-full opacity-15 blur-3xl animate-pulse" style={{ background: 'radial-gradient(circle, hsl(38 92% 50%), transparent)' }} />

      <div className="w-full max-w-sm space-y-6 relative z-10 animate-fade-in">
        <div className="text-center space-y-3">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-medium" style={{ background: 'linear-gradient(135deg, hsl(217 91% 60% / 0.2), hsl(172 66% 50% / 0.15))', border: '1px solid hsl(217 91% 60% / 0.3)' }}>
            <Factory size={14} className="text-primary" />
            <span className="text-primary">Ashok Leyland</span>
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight">
            <span className="text-primary" style={{ textShadow: '0 0 30px hsl(217 91% 60% / 0.3)' }}>AL-Scout</span>{' '}
            <span className="text-accent" style={{ textShadow: '0 0 30px hsl(172 66% 50% / 0.3)' }}>3D</span>
          </h1>
          <p className="text-sm text-muted-foreground">Reset your password</p>
        </div>

        <div className="rounded-2xl p-6 space-y-4" style={{ background: 'hsl(222 22% 12% / 0.7)', backdropFilter: 'blur(24px)', border: '1px solid hsl(220 15% 22% / 0.5)', boxShadow: '0 20px 60px hsl(0 0% 0% / 0.4), inset 0 1px 0 hsl(220 15% 30% / 0.2)' }}>
          {sent ? (
            <div className="text-center space-y-3">
              <Mail size={32} className="text-primary mx-auto" />
              <p className="text-sm text-foreground">Reset link sent to <strong>{email}</strong></p>
              <p className="text-xs text-muted-foreground">Check your inbox and follow the link.</p>
              <Link to="/login" className="text-xs text-primary hover:underline">Back to Login</Link>
            </div>
          ) : (
            <form onSubmit={handleReset} className="space-y-4">
              {error && <div className="text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2 border border-destructive/20">{error}</div>}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Email</label>
                <input type="email" required value={email} onChange={e => setEmail(e.target.value)} className="w-full h-10 rounded-lg border border-input bg-secondary/50 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all" placeholder="you@example.com" />
              </div>
              <button type="submit" disabled={loading} className="w-full h-10 rounded-lg font-semibold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50" style={{ background: 'linear-gradient(135deg, hsl(217 91% 60%), hsl(217 91% 50%))', color: 'hsl(0 0% 100%)', boxShadow: '0 4px 15px hsl(217 91% 60% / 0.3)' }}>
                {loading ? 'Sending...' : 'Reset Password'}
              </button>
              <div className="text-center text-xs">
                <Link to="/login" className="text-primary hover:underline">Back to Login</Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;
