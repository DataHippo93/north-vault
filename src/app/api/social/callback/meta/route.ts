import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { exchangeCodeForToken, listAdAccounts } from '@/lib/social/meta'
import { encrypt } from '@/lib/utils/encryption'
import { NextResponse, type NextRequest } from 'next/server'
import { createHmac } from 'crypto'
import { cookies } from 'next/headers'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/auth/login', request.url))

  const cookieStore = await cookies()
  const stateCookie = cookieStore.get('meta_oauth_state')?.value
  const business = cookieStore.get('meta_oauth_business')?.value || 'both'

  // Clean up cookies
  cookieStore.delete('meta_oauth_state')
  cookieStore.delete('meta_oauth_business')

  const code = request.nextUrl.searchParams.get('code')
  const state = request.nextUrl.searchParams.get('state')
  const error = request.nextUrl.searchParams.get('error')

  if (error) {
    return NextResponse.redirect(new URL(`/admin/social?error=${encodeURIComponent(error)}`, request.url))
  }

  if (!code || !state || !stateCookie) {
    return NextResponse.redirect(new URL('/admin/social?error=invalid_state', request.url))
  }

  // Validate CSRF state
  const [userId, nonce, expectedState] = stateCookie.split(':')
  const computed = createHmac('sha256', process.env.META_APP_SECRET!).update(`${userId}:${nonce}`).digest('hex')

  if (state !== expectedState || state !== computed || userId !== user.id) {
    return NextResponse.redirect(new URL('/admin/social?error=csrf_mismatch', request.url))
  }

  try {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL!
    const redirectUri = `${siteUrl}/api/social/callback/meta`
    const tokens = await exchangeCodeForToken(code, redirectUri)

    // Get ad accounts
    const accounts = await listAdAccounts(tokens.accessToken)
    if (accounts.length === 0) {
      return NextResponse.redirect(new URL('/admin/social?error=no_ad_accounts', request.url))
    }

    // Store each ad account as a connection
    const serviceClient = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    // Encrypt token and convert to hex string for bytea column
    const encryptedToken = '\\x' + encrypt(tokens.accessToken).toString('hex')

    for (const account of accounts) {
      await serviceClient
        .schema('northvault')
        .from('social_connections')
        .upsert(
          {
            platform: 'meta',
            business,
            account_id: account.id,
            account_name: account.name,
            access_token_encrypted: encryptedToken,
            token_expires_at: tokens.expiresAt?.toISOString() ?? null,
            scopes: tokens.scopes,
            connected_by: user.id,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'platform,account_id' },
        )
    }

    return NextResponse.redirect(new URL('/admin/social?connected=meta', request.url))
  } catch (err) {
    console.error('Meta OAuth callback error:', err)
    return NextResponse.redirect(
      new URL(`/admin/social?error=${encodeURIComponent((err as Error).message)}`, request.url),
    )
  }
}
