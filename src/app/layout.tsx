import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Northvault — Brand Asset Management',
  description: 'Internal digital asset management for Nature\'s Storehouse and ADK Fragrance Farm',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col bg-wood-50 text-sage-950">
        {children}
      </body>
    </html>
  )
}
