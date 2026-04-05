import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'NorthVault — Brand Asset Management',
  description: 'Internal digital asset management for Nature\'s Storehouse and ADK Fragrance Farm',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col bg-[#faf9f7] text-stone-800">
        {children}
      </body>
    </html>
  )
}
