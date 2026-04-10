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
    { href: '/people', label: 'People' },
    { href: '/upload', label: 'Upload' },
    { href: '/pr', label: 'PR & Media' },
    { href: '/admin', label: 'Admin', adminOnly: true },
  ]

  return (
    <div className="bg-wood-50 flex min-h-screen flex-col">
      {/* Executive top nav — deep sage with warm accents */}
      <header className="bg-sage-950 sticky top-0 z-40 text-white shadow-lg">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-8">
              <Link href="/library" className="flex items-center gap-2.5">
                <div className="bg-vault-600 flex h-8 w-8 items-center justify-center rounded-lg shadow-sm">
                  <svg
                    className="h-4 w-4 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                    />
                  </svg>
                </div>
                <span className="text-lg font-semibold tracking-tight text-white">NorthVault</span>
              </Link>
              <nav className="hidden items-center gap-1 sm:flex">
                {navLinks.map((link) => {
                  if (link.adminOnly && userRole !== 'admin') return null
                  const isActive = pathname.startsWith(link.href)
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                        isActive ? 'bg-vault-700 text-white' : 'text-sage-300 hover:bg-white/5 hover:text-white'
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
                <span className="text-sage-400 hidden max-w-[180px] truncate text-xs sm:block">{userEmail}</span>
              )}
              <button onClick={handleSignOut} className="text-sage-400 text-sm transition-colors hover:text-white">
                Sign out
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 pb-24 sm:px-6 sm:pb-8 lg:px-8">{children}</main>

      {/* Mobile bottom navigation bar */}
      <nav className="border-sage-200 fixed inset-x-0 bottom-0 z-40 flex border-t bg-white sm:hidden">
        <Link
          href="/library"
          className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs font-medium transition-colors ${
            pathname.startsWith('/library') ? 'text-vault-600' : 'text-sage-400 hover:text-vault-600'
          }`}
        >
          <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
            />
          </svg>
          Library
        </Link>

        <Link
          href="/people"
          className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs font-medium transition-colors ${
            pathname.startsWith('/people') ? 'text-vault-600' : 'text-sage-400 hover:text-vault-600'
          }`}
        >
          <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17 20a4 4 0 00-8 0m8 0a4 4 0 10-8 0m8 0H7m10 0h2m-2 0a2 2 0 100-4m-8 4H5m2 0a2 2 0 110-4m0 4h10m-7-8a3 3 0 100-6 3 3 0 000 6zm8 2a2 2 0 100-4 2 2 0 000 4z"
            />
          </svg>
          People
        </Link>

        <Link
          href="/upload"
          className="flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs font-medium text-white transition-colors"
        >
          <span className="bg-vault-600 -mt-6 flex h-12 w-12 items-center justify-center rounded-full border-4 border-white shadow-lg">
            <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
          </span>
          <span className="text-vault-600 mt-1">Upload</span>
        </Link>

        <Link
          href="/pr"
          className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs font-medium transition-colors ${
            pathname.startsWith('/pr') ? 'text-vault-600' : 'text-sage-400 hover:text-vault-600'
          }`}
        >
          <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 12h6"
            />
          </svg>
          PR
        </Link>

        {userRole === 'admin' ? (
          <Link
            href="/admin"
            className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs font-medium transition-colors ${
              pathname.startsWith('/admin') ? 'text-vault-600' : 'text-sage-400 hover:text-vault-600'
            }`}
          >
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Admin
          </Link>
        ) : (
          <div className="flex-1" />
        )}
      </nav>

      {/* Footer — hidden on mobile where bottom nav lives */}
      <footer className="border-sage-200 bg-wood-50 hidden border-t sm:block">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <p className="text-sage-400 text-center text-xs">&copy; 2026 NorthVault. All rights reserved.</p>
        </div>
      </footer>
    </div>
  )
}
