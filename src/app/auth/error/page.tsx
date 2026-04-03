'use client'

import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Suspense } from 'react'

function ErrorContent() {
  const params = useSearchParams()
  const message = params.get('message') || 'An authentication error occurred.'

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0b1120] via-[#0f1d2e] to-[#122a1e] px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 shadow-lg shadow-emerald-900/30 mb-5">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">NorthVault</h1>
        </div>
        <div className="bg-[#111c2e]/80 backdrop-blur-sm rounded-2xl border border-white/10 shadow-2xl shadow-black/40 p-8 text-center">
          <h2 className="text-lg font-semibold text-white mb-4">Authentication error</h2>
          <p className="text-sm text-red-300 bg-red-900/30 border border-red-500/20 rounded-lg px-4 py-2.5 mb-6">{message}</p>
          <Link
            href="/auth/login"
            className="inline-block bg-gradient-to-r from-emerald-600 to-emerald-700 text-white py-2.5 px-6 rounded-lg text-sm font-semibold hover:from-emerald-500 hover:to-emerald-600 transition-all shadow-lg shadow-emerald-900/30"
          >
            Back to login
          </Link>
        </div>
        <p className="text-center text-xs text-slate-600 mt-8">&copy; 2026 NorthVault. All rights reserved.</p>
      </div>
    </div>
  )
}

export default function ErrorPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0b1120] via-[#0f1d2e] to-[#122a1e]"><p className="text-slate-400">Loading...</p></div>}>
      <ErrorContent />
    </Suspense>
  )
}
