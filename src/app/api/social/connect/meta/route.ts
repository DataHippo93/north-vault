import { createClient } from '@/lib/supabase/server'
import { getAuthUrl } from '@/lib/social/meta'
import { NextResponse, type NextRequest } from 'next/server'
import { randomBytes, createHmac } from 'crypto'
import { cookies } from 'next/headers'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Admin check
  const { data: profile } = await supabase
    .schema('northvault')
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'Admin required' }, { status: 403 })

  if (!process.env.META_APP_ID || !process.env.META_APP_SECRET) {
    return NextResponse.json({ error: 'Meta app not configured' }, { status: 500 })
  }

  // Generate CSRF state token
  const nonce = randomBytes(16).toString('hex')
  const state = createHmac('sha256', process.env.META_APP_SECRET).update(`${user.id}:${nonce}`).digest('hex')

  const cookieStore = await cookies()
  cookieStore.set('meta_oauth_state', `${user.id}:${nonce}:${state}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600, // 10 minutes
    path: '/',
  })

  const business = request.nextUrl.searchParams.get('business') || 'both'
  cookieStore.set('meta_oauth_business', business, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  })

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL!
  const redirectUri = `${siteUrl}/api/social/callback/meta`
  const authUrl = getAuthUrl(redirectUri, state)

  return NextResponse.redirect(authUrl)
}
