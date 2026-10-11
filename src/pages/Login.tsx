import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Factory, LogIn } from 'lucide-react';

// Particle animation component
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
    for (let i = 0; i < 60; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        size: Math.random() * 2 + 0.5,
        opacity: Math.random() * 0.5 + 0.1,
      });
    }

    let animId: number;
    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      particles.forEach((p, i) => {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
        if (p.y < 0 || p.y > canvas.height) p.vy *= -1;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(217, 91%, 60%, ${p.opacity})`;
        ctx.fill();

        // Draw connections
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[j].x - p.x;
          const dy = particles[j].y - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 120) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `hsla(217, 91%, 60%, ${0.08 * (1 - dist / 120)})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      });
      animId = requestAnimationFrame(animate);
    };
    animate();

    const handleResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);
    return () => { cancelAnimationFrame(animId); window.removeEventListener('resize', handleResize); };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 z-0" />;
};

const Login = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      navigate('/');
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 relative overflow-hidden">
      {/* Animated background */}
      <ParticleField />

      {/* Gradient orbs */}
      <div className="absolute top-1/4 -left-32 w-96 h-96 rounded-full opacity-20 blur-3xl animate-pulse" style={{ background: 'radial-gradient(circle, hsl(217 91% 60%), transparent)' }} />
      <div className="absolute bottom-1/4 -right-32 w-80 h-80 rounded-full opacity-15 blur-3xl animate-pulse" style={{ background: 'radial-gradient(circle, hsl(172 66% 50%), transparent)', animationDelay: '1s' }} />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full opacity-5 blur-3xl" style={{ background: 'radial-gradient(circle, hsl(217 91% 60%), transparent)' }} />

      <div className="w-full max-w-sm space-y-6 relative z-10 animate-fade-in">
        <div className="text-center space-y-3">
          {/* 3D rotating logo effect */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-medium"
            style={{
              background: 'linear-gradient(135deg, hsl(217 91% 60% / 0.2), hsl(172 66% 50% / 0.15))',
              border: '1px solid hsl(217 91% 60% / 0.3)',
              boxShadow: '0 0 20px hsl(217 91% 60% / 0.15)',
            }}
          >
            <Factory size={14} className="text-primary" />
            <span className="text-primary">Ashok Leyland</span>
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight">
            <span className="text-primary" style={{ textShadow: '0 0 30px hsl(217 91% 60% / 0.3)' }}>AL-Scout</span>{' '}
            <span className="text-accent" style={{ textShadow: '0 0 30px hsl(172 66% 50% / 0.3)' }}>3D</span>
          </h1>
          <p className="text-sm text-muted-foreground">Industrial Land Scouting Platform</p>
        </div>

        <form onSubmit={handleLogin} className="rounded-2xl p-6 space-y-4"
          style={{
            background: 'hsl(222 22% 12% / 0.7)',
            backdropFilter: 'blur(24px)',
            border: '1px solid hsl(220 15% 22% / 0.5)',
            boxShadow: '0 20px 60px hsl(0 0% 0% / 0.4), 0 0 0 1px hsl(220 15% 22% / 0.2), inset 0 1px 0 hsl(220 15% 30% / 0.2)',
          }}
        >
          {error && (
            <div className="text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2 border border-destructive/20">{error}</div>
          )}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full h-10 rounded-lg border border-input bg-secondary/50 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all"
              placeholder="you@example.com"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full h-10 rounded-lg border border-input bg-secondary/50 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-all"
              placeholder="••••••••"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full h-10 rounded-lg font-semibold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50"
            style={{
              background: 'linear-gradient(135deg, hsl(217 91% 60%), hsl(217 91% 50%))',
              color: 'hsl(0 0% 100%)',
              boxShadow: '0 4px 15px hsl(217 91% 60% / 0.3)',
            }}
          >
            <LogIn size={16} />
            {loading ? 'Signing in...' : 'Login'}
          </button>
          <div className="flex items-center justify-between text-xs">
            <Link to="/signup" className="text-primary hover:underline">Create Account</Link>
            <Link to="/forgot-password" className="text-muted-foreground hover:text-foreground transition-colors">Forgot Password?</Link>
          </div>
        </form>

        <p className="text-center text-[10px] text-muted-foreground/50">
          Powered by Geospatial AI Stack
        </p>
      </div>
    </div>
  );
};

export default Login;
