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
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>

      {/* Footer */}
      <footer className="border-t border-sage-200 bg-wood-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <p className="text-xs text-sage-400 text-center">&copy; 2026 NorthVault. All rights reserved.</p>
        </div>
      </footer>
    </div>
  )
}
