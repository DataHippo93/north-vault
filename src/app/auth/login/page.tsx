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
  const [showPassword, setShowPassword] = useState(false)

  const supabase = createClient()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      if (error.message?.toLowerCase().includes('ban')) {
        setError('Your account has been deactivated. Contact an admin.')
      } else {
        setError(error.message)
      }
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
    <div className="from-sage-950 via-sage-900 to-vault-950 flex min-h-screen items-center justify-center bg-gradient-to-br px-4">
      <div className="w-full max-w-md">
        {/* Logo/Brand */}
        <div className="mb-10 text-center">
          <div className="from-vault-500 to-vault-700 shadow-vault-900/40 mb-5 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br shadow-lg">
            <svg className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white">NorthVault</h1>
          <p className="text-sage-400 mt-1.5 text-sm">Digital Asset Management</p>
        </div>

        <div className="bg-sage-900/60 rounded-2xl border border-white/10 p-8 shadow-2xl shadow-black/40 backdrop-blur-sm">
          {mode === 'login' ? (
            <>
              <h2 className="mb-6 text-lg font-semibold text-white">Sign in to your account</h2>
              <form onSubmit={handleLogin} className="space-y-5">
                <div>
                  <label className="text-sage-300 mb-1.5 block text-sm font-medium">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="bg-sage-950/60 placeholder-sage-500 focus:ring-vault-500/50 focus:border-vault-500/50 w-full rounded-lg border border-white/10 px-4 py-2.5 text-sm text-white transition-colors focus:ring-2 focus:outline-none"
                    placeholder="you@example.com"
                  />
                </div>
                <div>
                  <label className="text-sage-300 mb-1.5 block text-sm font-medium">Password</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className="bg-sage-950/60 placeholder-sage-500 focus:ring-vault-500/50 focus:border-vault-500/50 w-full rounded-lg border border-white/10 px-4 py-2.5 pr-10 text-sm text-white transition-colors focus:ring-2 focus:outline-none"
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="text-sage-400 hover:text-sage-200 absolute inset-y-0 right-0 flex items-center pr-3 transition-colors"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? (
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                          />
                        </svg>
                      ) : (
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                          />
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                          />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
                {error && (
                  <div className="rounded-lg border border-red-500/20 bg-red-900/30 px-4 py-2.5 text-sm text-red-300">
                    {error}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={loading}
                  className="from-vault-600 to-vault-700 hover:from-vault-500 hover:to-vault-600 shadow-vault-900/40 w-full cursor-pointer rounded-lg bg-gradient-to-r py-2.5 text-sm font-semibold text-white shadow-lg transition-all disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? 'Signing in...' : 'Sign In'}
                </button>
              </form>
              <button
                onClick={() => {
                  setMode('reset')
                  setError(null)
                }}
                className="text-sage-400 hover:text-vault-400 mt-5 w-full cursor-pointer text-center text-sm transition-colors"
              >
                Forgot password?
              </button>
            </>
          ) : (
            <>
              <h2 className="mb-2 text-lg font-semibold text-white">Reset password</h2>
              {resetSent ? (
                <div className="text-vault-300 bg-vault-900/30 border-vault-500/20 mt-4 rounded-lg border px-4 py-3 text-sm">
                  Check your email for a password reset link.
                </div>
              ) : (
                <form onSubmit={handleReset} className="mt-4 space-y-5">
                  <div>
                    <label className="text-sage-300 mb-1.5 block text-sm font-medium">Email</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="bg-sage-950/60 placeholder-sage-500 focus:ring-vault-500/50 focus:border-vault-500/50 w-full rounded-lg border border-white/10 px-4 py-2.5 text-sm text-white transition-colors focus:ring-2 focus:outline-none"
                      placeholder="you@example.com"
                    />
                  </div>
                  {error && (
                    <div className="rounded-lg border border-red-500/20 bg-red-900/30 px-4 py-2.5 text-sm text-red-300">
                      {error}
                    </div>
                  )}
                  <button
                    type="submit"
                    disabled={loading}
                    className="from-vault-600 to-vault-700 hover:from-vault-500 hover:to-vault-600 shadow-vault-900/40 w-full cursor-pointer rounded-lg bg-gradient-to-r py-2.5 text-sm font-semibold text-white shadow-lg transition-all disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {loading ? 'Sending...' : 'Send reset link'}
                  </button>
                </form>
              )}
              <button
                onClick={() => {
                  setMode('login')
                  setError(null)
                  setResetSent(false)
                }}
                className="text-sage-400 hover:text-vault-400 mt-5 w-full cursor-pointer text-center text-sm transition-colors"
              >
                Back to sign in
              </button>
            </>
          )}
        </div>

        <p className="text-sage-600 mt-8 text-center text-xs">&copy; 2026 NorthVault. All rights reserved.</p>
      </div>
    </div>
  )
}
