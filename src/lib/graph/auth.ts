/**
 * Microsoft Graph API authentication using client credentials flow.
 * Reads Azure app credentials from environment variables.
 */

const TENANT_ID = process.env.AZURE_TENANT_ID || '7df011e1-eb7e-46bc-b4f8-9ea223936cc6'
const CLIENT_ID = process.env.AZURE_CLIENT_ID || 'b38234ad-7453-4a53-8353-25bf63852d2d'

let cachedToken: { token: string; expiresAt: number } | null = null

export async function getGraphToken(): Promise<string> {
  // Return cached token if still valid (with 60s buffer)
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token
  }

  const clientSecret = process.env.AZURE_CLIENT_SECRET
  if (!clientSecret) {
    throw new Error('AZURE_CLIENT_SECRET environment variable is not set')
  }

  const url = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: CLIENT_ID,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
  })

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Graph auth failed (${res.status}): ${errText}`)
  }

  const data = await res.json()
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  }

  return cachedToken.token
}

export async function graphFetch(path: string, options?: RequestInit): Promise<Response> {
  const token = await getGraphToken()
  return fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...options?.headers,
    },
  })
}
