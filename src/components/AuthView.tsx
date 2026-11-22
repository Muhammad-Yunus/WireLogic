import React, { useState } from 'react';
import { ArrowRight, Database, Lock, Mail, User, Zap } from 'lucide-react';
import { apiFetch, setAuthToken } from '../lib/api';
import type { AuthUser } from '../shared/types';

interface AuthViewProps {
  onAuthenticated: (user: AuthUser, token: string) => void;
}

export function AuthView({ onAuthenticated }: AuthViewProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const payload = mode === 'login' ? { email, password } : { name, email, password };
      const res = await apiFetch<{ user: AuthUser; token: string }>(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setAuthToken(res.token);
      onAuthenticated(res.user, res.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen w-full tekna-canvas-dots flex flex-col justify-between p-4 sm:p-8">
      <header className="max-w-5xl w-full mx-auto flex items-center justify-between py-2">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-[#DCFCE7] border border-[#BBF7D0] flex items-center justify-center">
            <Zap className="w-3.5 h-3.5 text-[#16A34A]" />
          </div>
          <span className="text-[15px] font-semibold tracking-tight text-[#0F172A]">WireLogic</span>
        </div>
        <a
          href="/api/docs"
          target="_blank"
          rel="noreferrer"
          className="text-[13px] font-medium text-[#475569] hover:text-[#0F172A] transition-colors"
        >
          API Docs (Swagger)
        </a>
      </header>

      <main className="flex-1 flex items-center justify-center py-8">
        <div className="w-full max-w-[420px] bg-white border border-[#DCE2EC] rounded-xl shadow-[0_8px_30px_rgba(15,23,42,0.06)] p-7">
          <div className="mb-6">
            <h1 className="text-[20px] font-semibold text-[#0F172A] tracking-tight">
              {mode === 'login' ? 'Sign in to WireLogic' : 'Create your WireLogic workspace'}
            </h1>
            <p className="text-[13px] text-[#64748B] mt-1">
              {mode === 'login'
                ? 'Access your visual pipelines, encrypted vault, and live telemetry.'
                : 'Provisions Northwinds DB and the Generate Weather Report starter flow.'}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-1 p-1 bg-[#F1F5F9] rounded-lg mb-5">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
              }}
              className={`py-1.5 text-[13px] font-medium rounded-md transition-colors ${
                mode === 'login'
                  ? 'bg-white text-[#0F172A] shadow-xs'
                  : 'text-[#64748B] hover:text-[#0F172A]'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError(null);
              }}
              className={`py-1.5 text-[13px] font-medium rounded-md transition-colors ${
                mode === 'register'
                  ? 'bg-white text-[#0F172A] shadow-xs'
                  : 'text-[#64748B] hover:text-[#0F172A]'
              }`}
            >
              Create Account
            </button>
          </div>

          {error && (
            <div className="mb-4 px-3.5 py-2.5 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-[12.5px] text-[#B91C1C]">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <div>
                <label className="block text-[12px] font-medium text-[#334155] mb-1.5">
                  Full Name
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-[#94A3B8] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Alex Morgan"
                    className="w-full pl-9 pr-3 py-2 text-[13.5px] bg-white border border-[#DCE2EC] rounded-lg focus:outline-none focus:border-[#4B4DED]"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-[12px] font-medium text-[#334155] mb-1.5">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-[#94A3B8] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="w-full pl-9 pr-3 py-2 text-[13.5px] bg-white border border-[#DCE2EC] rounded-lg focus:outline-none focus:border-[#4B4DED]"
                />
              </div>
            </div>

            <div>
              <label className="block text-[12px] font-medium text-[#334155] mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-[#94A3B8] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'register' ? 'Minimum 6 characters' : 'Enter your password'}
                  className="w-full pl-9 pr-3 py-2 text-[13.5px] bg-white border border-[#DCE2EC] rounded-lg focus:outline-none focus:border-[#4B4DED]"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-[#4B4DED] hover:bg-[#4338CA] disabled:opacity-60 text-white text-[13.5px] font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <span>{loading ? 'Authenticating...' : mode === 'login' ? 'Sign In' : 'Create Workspace'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          <div className="mt-5 pt-4 border-t border-[#F1F5F9] flex items-center gap-2 text-[12px] text-[#64748B]">
            <Database className="w-3.5 h-3.5 text-[#4B4DED] shrink-0" />
            <span>PostgreSQL + Drizzle ORM · AES-256-GCM Credential Vault · Socket.IO</span>
          </div>
        </div>
      </main>

      <footer className="max-w-5xl w-full mx-auto text-center text-[12px] text-[#94A3B8]">
        WireLogic Visual Workflow &amp; Data Orchestration
      </footer>
    </div>
  );
}
