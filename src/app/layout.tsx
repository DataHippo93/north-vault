import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'NorthVault',
    template: '%s | NorthVault',
  },
  description: "Internal digital asset management for Nature's Storehouse and ADK Fragrance Farm.",
  robots: { index: false, follow: false },
  icons: { icon: '/favicon.ico' },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="flex min-h-full flex-col bg-[#faf9f7] text-stone-800">{children}</body>
    </html>
  )
}
