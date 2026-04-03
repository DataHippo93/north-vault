'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function SetPasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  const supabase = createClient()

  useEffect(() => {
    supabase.auth.getSession().then(() => {
      setReady(true)
    })
  }, [])

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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-sage-950 via-sage-900 to-vault-950 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-vault-500 to-vault-700 shadow-lg shadow-vault-900/40 mb-5">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">NorthVault</h1>
          <p className="text-sm text-sage-400 mt-1.5">Digital Asset Management</p>
        </div>

        <div className="bg-sage-900/60 backdrop-blur-sm rounded-2xl border border-white/10 shadow-2xl shadow-black/40 p-8">
          <h2 className="text-lg font-semibold text-white mb-2">Set your password</h2>
          <p className="text-sm text-sage-400 mb-6">Choose a strong password for your account.</p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-sage-300 mb-1.5">New password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                className="w-full px-4 py-2.5 bg-sage-950/60 border border-white/10 rounded-lg text-sm text-white placeholder-sage-500 focus:outline-none focus:ring-2 focus:ring-vault-500/50 focus:border-vault-500/50 transition-colors"
                placeholder="At least 8 characters"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-sage-300 mb-1.5">Confirm password</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                className="w-full px-4 py-2.5 bg-sage-950/60 border border-white/10 rounded-lg text-sm text-white placeholder-sage-500 focus:outline-none focus:ring-2 focus:ring-vault-500/50 focus:border-vault-500/50 transition-colors"
                placeholder="Repeat your password"
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
              className="w-full bg-gradient-to-r from-vault-600 to-vault-700 text-white py-2.5 rounded-lg text-sm font-semibold hover:from-vault-500 hover:to-vault-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-vault-900/40 cursor-pointer"
            >
              {loading ? 'Saving...' : 'Set password'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-sage-600 mt-8">&copy; 2026 NorthVault. All rights reserved.</p>
      </div>
    </div>
  )
}
