import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'

/**
 * Auth callback handler for Supabase PKCE and OTP flows.
 *
 * Two token formats arrive here depending on how Supabase sends the link:
 *
 * 1. PKCE code flow (`?code=xxx`): exchange the code for a session server-side
 *    so that auth cookies are set on the response before redirecting.
 *
 * 2. OTP / token-hash flow (`?token_hash=xxx&type=invite|recovery|...`):
 *    call verifyOtp server-side so the session is established and cookies are
 *    written before redirecting. Do NOT just forward the token_hash to the
 *    client — verifyOtp consumes the one-time token; forwarding it to the
 *    browser causes the browser to attempt a second verification which fails
 *    with otp_expired.
 */

function buildServerClient(request: NextRequest, responseRef: { value: NextResponse }) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          responseRef.value = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            responseRef.value.cookies.set(name, value, options),
          )
        },
      },
    },
  )
}

/**
 * Copy auth cookies from a source response (where Supabase wrote them) onto a
 * redirect response, preserving all original cookie options.
 */
function copyAuthCookies(source: NextResponse, target: NextResponse): NextResponse {
  source.cookies.getAll().forEach((cookie) => {
    const { name, value, ...options } = cookie
    target.cookies.set(name, value, options)
  })
  return target
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const tokenHash = requestUrl.searchParams.get('token_hash')
  const type = requestUrl.searchParams.get('type') as string | null
  const next = requestUrl.searchParams.get('next') ?? '/library'
  const origin = requestUrl.origin

  // ── PKCE code flow ──────────────────────────────────────────────────────────
  if (code) {
    const responseRef = { value: NextResponse.next({ request }) }
    const supabase = buildServerClient(request, responseRef)

    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      if (type === 'recovery') {
        return copyAuthCookies(
          responseRef.value,
          NextResponse.redirect(new URL('/auth/set-password', origin)),
        )
      }
      if (type === 'invite' || type === 'signup' || type === 'magiclink') {
        return copyAuthCookies(
          responseRef.value,
          NextResponse.redirect(new URL('/auth/set-password', origin)),
        )
      }
      return copyAuthCookies(
        responseRef.value,
        NextResponse.redirect(new URL(next, origin)),
      )
    }
    // Code exchange failed — fall through
  }

  // ── OTP / token-hash flow ───────────────────────────────────────────────────
  if (tokenHash && type) {
    const responseRef = { value: NextResponse.next({ request }) }
    const supabase = buildServerClient(request, responseRef)

    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as 'invite' | 'recovery' | 'email' | 'magiclink' | 'signup',
    })

    if (!error) {
      if (type === 'recovery') {
        return copyAuthCookies(
          responseRef.value,
          NextResponse.redirect(new URL('/auth/set-password', origin)),
        )
      }
      // invite, signup, magiclink, email → set-password
      return copyAuthCookies(
        responseRef.value,
        NextResponse.redirect(new URL('/auth/set-password', origin)),
      )
    }
    // verifyOtp failed — fall through to login
  }

  // Fallback: redirect to login
  return NextResponse.redirect(new URL('/auth/login', origin))
}
