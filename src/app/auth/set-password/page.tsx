'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function SetPasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const supabase = createClient()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      router.push('/library')
    }
  }

  return (
    <div className="from-sage-950 via-sage-900 to-vault-950 flex min-h-screen items-center justify-center bg-gradient-to-br px-4">
      <div className="w-full max-w-md">
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
          <h2 className="mb-2 text-lg font-semibold text-white">Set your password</h2>
          <p className="text-sage-400 mb-6 text-sm">Choose a strong password for your account.</p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="text-sage-300 mb-1.5 block text-sm font-medium">New password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                className="bg-sage-950/60 placeholder-sage-500 focus:ring-vault-500/50 focus:border-vault-500/50 w-full rounded-lg border border-white/10 px-4 py-2.5 text-sm text-white transition-colors focus:ring-2 focus:outline-none"
                placeholder="At least 8 characters"
              />
            </div>
            <div>
              <label className="text-sage-300 mb-1.5 block text-sm font-medium">Confirm password</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                className="bg-sage-950/60 placeholder-sage-500 focus:ring-vault-500/50 focus:border-vault-500/50 w-full rounded-lg border border-white/10 px-4 py-2.5 text-sm text-white transition-colors focus:ring-2 focus:outline-none"
                placeholder="Repeat your password"
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
              {loading ? 'Saving...' : 'Set password'}
            </button>
          </form>
        </div>

        <p className="text-sage-600 mt-8 text-center text-xs">&copy; 2026 NorthVault. All rights reserved.</p>
      </div>
    </div>
  )
}
