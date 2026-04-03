'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'login' | 'reset'>('login')
  const [resetSent, setResetSent] = useState(false)

  const supabase = createClient()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      router.push('/library')
      router.refresh()
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${siteUrl}/auth/callback?next=/auth/set-password`,
    })

    if (error) {
      setError(error.message)
    } else {
      setResetSent(true)
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0b1120] via-[#0f1d2e] to-[#122a1e] px-4">
      <div className="w-full max-w-md">
        {/* Logo/Brand */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 shadow-lg shadow-emerald-900/30 mb-5">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">NorthVault</h1>
          <p className="text-sm text-slate-400 mt-1.5">Digital Asset Management</p>
        </div>

        <div className="bg-[#111c2e]/80 backdrop-blur-sm rounded-2xl border border-white/10 shadow-2xl shadow-black/40 p-8">
          {mode === 'login' ? (
            <>
              <h2 className="text-lg font-semibold text-white mb-6">Sign in to your account</h2>
              <form onSubmit={handleLogin} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full px-4 py-2.5 bg-[#0b1120] border border-white/10 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 transition-colors"
                    placeholder="you@example.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full px-4 py-2.5 bg-[#0b1120] border border-white/10 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 transition-colors"
                    placeholder="••••••••"
                  />
                </div>
                {error && (
                  <div className="text-sm text-red-300 bg-red-900/30 border border-red-500/20 rounded-lg px-4 py-2.5">
                    {error}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-gradient-to-r from-emerald-600 to-emerald-700 text-white py-2.5 rounded-lg text-sm font-semibold hover:from-emerald-500 hover:to-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-emerald-900/30 cursor-pointer"
                >
                  {loading ? 'Signing in...' : 'Sign In'}
                </button>
              </form>
              <button
                onClick={() => { setMode('reset'); setError(null) }}
                className="mt-5 text-sm text-slate-400 hover:text-emerald-400 w-full text-center transition-colors cursor-pointer"
              >
                Forgot password?
              </button>
            </>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-white mb-2">Reset password</h2>
              {resetSent ? (
                <div className="text-sm text-emerald-300 bg-emerald-900/30 border border-emerald-500/20 rounded-lg px-4 py-3 mt-4">
                  Check your email for a password reset link.
                </div>
              ) : (
                <form onSubmit={handleReset} className="space-y-5 mt-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">Email</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="w-full px-4 py-2.5 bg-[#0b1120] border border-white/10 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 transition-colors"
                      placeholder="you@example.com"
                    />
                  </div>
                  {error && (
                    <div className="text-sm text-red-300 bg-red-900/30 border border-red-500/20 rounded-lg px-4 py-2.5">
                      {error}
                    </div>
                  )}
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-gradient-to-r from-emerald-600 to-emerald-700 text-white py-2.5 rounded-lg text-sm font-semibold hover:from-emerald-500 hover:to-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-emerald-900/30 cursor-pointer"
                  >
                    {loading ? 'Sending...' : 'Send reset link'}
                  </button>
                </form>
              )}
              <button
                onClick={() => { setMode('login'); setError(null); setResetSent(false) }}
                className="mt-5 text-sm text-slate-400 hover:text-emerald-400 w-full text-center transition-colors cursor-pointer"
              >
                Back to sign in
              </button>
            </>
          )}
        </div>

        <p className="text-center text-xs text-slate-600 mt-8">&copy; 2026 NorthVault. All rights reserved.</p>
      </div>
    </div>
  )
}
