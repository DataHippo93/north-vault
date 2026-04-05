'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface AppShellProps {
  children: React.ReactNode
  userEmail?: string
  userRole?: string
}

export default function AppShell({ children, userEmail, userRole }: AppShellProps) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/auth/login')
    router.refresh()
  }

  const navLinks = [
    { href: '/library', label: 'Library' },
    { href: '/upload', label: 'Upload' },
    { href: '/admin', label: 'Admin', adminOnly: true },
  ]

  return (
    <div className="min-h-screen flex flex-col bg-wood-50">
      {/* Executive top nav — deep sage with warm accents */}
      <header className="bg-sage-950 text-white shadow-lg sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-8">
              <Link href="/library" className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-vault-600 flex items-center justify-center shadow-sm">
                  <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <span className="text-lg font-semibold tracking-tight text-white">NorthVault</span>
              </Link>
              <nav className="hidden sm:flex items-center gap-1">
                {navLinks.map((link) => {
                  if (link.adminOnly && userRole !== 'admin') return null
                  const isActive = pathname.startsWith(link.href)
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-vault-700 text-white'
                          : 'text-sage-300 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      {link.label}
                    </Link>
                  )
                })}
              </nav>
            </div>
            <div className="flex items-center gap-4">
              {userEmail && (
                <span className="hidden sm:block text-xs text-sage-400 truncate max-w-[180px]">
                  {userEmail}
                </span>
              )}
              <button
                onClick={handleSignOut}
                className="text-sm text-sage-400 hover:text-white transition-colors"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-24 sm:pb-8">
        {children}
      </main>

      {/* Mobile bottom navigation bar */}
      <nav className="sm:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-sage-200 flex">
        <Link
          href="/library"
          className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-xs font-medium transition-colors ${
            pathname.startsWith('/library')
              ? 'text-vault-600'
              : 'text-sage-400 hover:text-vault-600'
          }`}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
          </svg>
          Library
        </Link>

        <Link
          href="/upload"
          className="flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-xs font-medium transition-colors text-white"
        >
          <span className="flex items-center justify-center w-12 h-12 -mt-6 rounded-full bg-vault-600 shadow-lg border-4 border-white">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          </span>
          <span className="text-vault-600 mt-1">Upload</span>
        </Link>

        {userRole === 'admin' ? (
          <Link
            href="/admin"
            className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-xs font-medium transition-colors ${
              pathname.startsWith('/admin')
                ? 'text-vault-600'
                : 'text-sage-400 hover:text-vault-600'
            }`}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Admin
          </Link>
        ) : (
          <div className="flex-1" />
        )}
      </nav>

      {/* Footer — hidden on mobile where bottom nav lives */}
      <footer className="hidden sm:block border-t border-sage-200 bg-wood-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <p className="text-xs text-sage-400 text-center">&copy; 2026 NorthVault. All rights reserved.</p>
        </div>
      </footer>
    </div>
  )
}
