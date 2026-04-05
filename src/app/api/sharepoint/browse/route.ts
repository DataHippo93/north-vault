import { createClient } from '@/lib/supabase/server'
import { NextResponse, type NextRequest } from 'next/server'

export const runtime = 'nodejs'

/**
 * Acquire an app-only access token for Microsoft Graph using client credentials flow.
 */
async function getGraphToken(): Promise<string> {
  const tenantId = process.env.AZURE_TENANT_ID
  const clientId = process.env.AZURE_CLIENT_ID
  const clientSecret = process.env.AZURE_CLIENT_SECRET

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('Missing Azure credentials (AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET)')
  }

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
  })

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Token request failed (${res.status}): ${err}`)
  }

  const data = await res.json()
  return data.access_token as string
}

interface GraphDriveItem {
  id: string
  name: string
  size?: number
  file?: { mimeType: string }
  folder?: { childCount: number }
  '@microsoft.graph.downloadUrl'?: string
  webUrl?: string
}

interface BrowseResult {
  name: string
  size: number
  mimeType: string
  downloadUrl: string
  webUrl: string
  isFolder: boolean
}

/**
 * Parse a SharePoint URL into Graph API components.
 * Supports patterns like:
 *   https://{tenant}.sharepoint.com/sites/{site}/Shared Documents/{path}
 *   https://{tenant}.sharepoint.com/:f:/s/{site}/...
 */
function parseSharePointUrl(url: string): { hostname: string; sitePath: string; itemPath: string } | null {
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname

    // Match /sites/{siteName} or /s/{siteName}
    const siteMatch = parsed.pathname.match(/\/(?:sites|s)\/([^/]+)/)
    if (!siteMatch) return null

    const sitePath = `/sites/${siteMatch[1]}`

    // Extract the folder path after "Shared Documents" or "Documents"
    const docMatch = parsed.pathname.match(/\/(?:Shared Documents|Documents|Shared%20Documents)\/?(.*)?/)
    const itemPath = docMatch?.[1]
      ? decodeURIComponent(docMatch[1]).replace(/\/$/, '')
      : ''

    return { hostname, sitePath, itemPath }
  } catch {
    return null
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const folderUrl: string | undefined = body.folderUrl
  const siteId: string | undefined = body.siteId
  const driveId: string | undefined = body.driveId
  const folderId: string | undefined = body.folderId
  const folderPath: string | undefined = body.folderPath

  // --- Resolve Graph endpoint ---
  let graphEndpoint: string

  if (driveId && folderId) {
    // Direct drive + folder ID
    graphEndpoint = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${folderId}/children`
  } else if (driveId && folderPath) {
    // Drive ID + path
    const encodedPath = encodeURIComponent(folderPath).replace(/%2F/g, '/')
    graphEndpoint = `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodedPath}:/children`
  } else if (driveId) {
    // Drive root
    graphEndpoint = `https://graph.microsoft.com/v1.0/drives/${driveId}/root/children`
  } else if (siteId) {
    // Get default drive for site, then list root or path
    graphEndpoint = folderPath
      ? `https://graph.microsoft.com/v1.0/sites/${siteId}/drive/root:/${encodeURIComponent(folderPath).replace(/%2F/g, '/')}:/children`
      : `https://graph.microsoft.com/v1.0/sites/${siteId}/drive/root/children`
  } else if (folderUrl) {
    // Parse a SharePoint URL
    const parsed = parseSharePointUrl(folderUrl)
    if (!parsed) {
      return NextResponse.json({
        error: 'Could not parse SharePoint URL. Expected format: https://{tenant}.sharepoint.com/sites/{site}/Shared Documents/{path}',
      }, { status: 400 })
    }

    // First resolve the site ID from the hostname + site path
    let token: string
    try {
      token = await getGraphToken()
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to get Graph token' }, { status: 500 })
    }

    const siteRes = await fetch(
      `https://graph.microsoft.com/v1.0/sites/${parsed.hostname}:${parsed.sitePath}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )

    if (!siteRes.ok) {
      const errText = await siteRes.text()
      return NextResponse.json({ error: `Site lookup failed (${siteRes.status}): ${errText}` }, { status: 502 })
    }

    const siteData = await siteRes.json()
    const resolvedSiteId = siteData.id

    graphEndpoint = parsed.itemPath
      ? `https://graph.microsoft.com/v1.0/sites/${resolvedSiteId}/drive/root:/${encodeURIComponent(parsed.itemPath).replace(/%2F/g, '/')}:/children`
      : `https://graph.microsoft.com/v1.0/sites/${resolvedSiteId}/drive/root/children`
  } else {
    return NextResponse.json({
      error: 'Provide folderUrl, or siteId, or driveId (with optional folderId/folderPath)',
    }, { status: 400 })
  }

  // --- Fetch token if not already fetched ---
  let token: string
  try {
    token = await getGraphToken()
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to get Graph token' }, { status: 500 })
  }

  // --- List children ---
  const selectFields = 'id,name,size,file,folder,webUrl,@microsoft.graph.downloadUrl'
  const separator = graphEndpoint.includes('?') ? '&' : '?'
  const listUrl = `${graphEndpoint}${separator}$select=${selectFields}&$top=200`

  const listRes = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!listRes.ok) {
    const errText = await listRes.text()
    return NextResponse.json({ error: `Graph list failed (${listRes.status}): ${errText}` }, { status: 502 })
  }

  const listData = await listRes.json()
  const items: GraphDriveItem[] = listData.value || []

  const results: BrowseResult[] = items.map((item) => ({
    name: item.name,
    size: item.size ?? 0,
    mimeType: item.file?.mimeType ?? (item.folder ? 'folder' : 'application/octet-stream'),
    downloadUrl: item['@microsoft.graph.downloadUrl'] ?? '',
    webUrl: item.webUrl ?? '',
    isFolder: !!item.folder,
  }))

  return NextResponse.json({ files: results, count: results.length })
}
