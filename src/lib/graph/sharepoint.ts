/**
 * SharePoint file enumeration via Microsoft Graph API.
 * Recursively lists all files in a SharePoint document library folder.
 */

import { graphFetch, getGraphToken } from './auth'

export interface SharePointFile {
  id: string
  name: string
  size: number
  mimeType: string
  downloadUrl: string
  lastModified: string
  /** Relative path from the drive root, e.g. "/Content Marketing/Spring 2024" */
  path: string
}

interface DriveItem {
  id: string
  name: string
  size?: number
  file?: { mimeType: string }
  folder?: { childCount: number }
  lastModifiedDateTime: string
  parentReference?: { path: string }
  '@microsoft.graph.downloadUrl'?: string
}

/**
 * Parse a SharePoint URL into site and drive info.
 * Supports URLs like:
 *   https://tenant.sharepoint.com/sites/sitename/Shared%20Documents/Forms/AllItems.aspx
 *   https://tenant.sharepoint.com/sites/sitename/Shared%20Documents/subfolder
 */
export function parseSharePointUrl(url: string): {
  hostname: string
  sitePath: string
  folderPath: string | null
} {
  const u = new URL(url)
  const hostname = u.hostname

  const pathMatch = u.pathname.match(/^(\/sites\/[^/]+)/)
  if (!pathMatch) {
    throw new Error('Could not parse SharePoint site from URL. Expected /sites/<name> in path.')
  }
  const sitePath = pathMatch[1]

  // AllItems.aspx view URLs encode the folder in the `id` query param
  let folderPath: string | null = null

  const idParam = u.searchParams.get('id')
  if (idParam) {
    const decoded = decodeURIComponent(idParam)
    const docMatch = decoded.match(/\/(?:Shared Documents|Documents)\/(.+)$/)
    if (docMatch) {
      const extracted = docMatch[1].replace(/\/Forms\/AllItems\.aspx$/, '').trim()
      folderPath = extracted || null
    }
  }

  if (!folderPath) {
    const docMatch = u.pathname.match(
      /\/(?:Shared%20Documents|Shared Documents|Documents)\/?(.*?)(?:\/Forms\/AllItems\.aspx)?$/,
    )
    const extracted = docMatch?.[1]
      ?.replace(/\/Forms\/AllItems\.aspx$/, '')
      .replace(/%20/g, ' ')
      .trim()
    folderPath = extracted || null
  }

  return { hostname, sitePath, folderPath }
}

/**
 * Resolve a drive ID. Prefers the explicit override, then the env var,
 * then falls back to querying the site's document libraries.
 */
async function resolveDriveId(hostname: string, sitePath: string, driveIdOverride?: string): Promise<string> {
  if (driveIdOverride) return driveIdOverride
  if (process.env.SHAREPOINT_ADK_DRIVE_ID) return process.env.SHAREPOINT_ADK_DRIVE_ID

  const siteRes = await graphFetch(`/sites/${hostname}:${sitePath}`)
  if (!siteRes.ok) {
    const err = await siteRes.text()
    throw new Error(`Failed to get site: ${err}`)
  }
  const site = await siteRes.json()

  const drivesRes = await graphFetch(`/sites/${site.id}/drives`)
  if (!drivesRes.ok) {
    const err = await drivesRes.text()
    throw new Error(`Failed to get drives: ${err}`)
  }
  const drives = await drivesRes.json()

  const drive =
    drives.value.find((d: { name: string }) => d.name === 'Documents' || d.name === 'Shared Documents') ||
    drives.value[0]

  if (!drive) throw new Error('No document library found on this site')
  return drive.id
}

/**
 * Encode a folder path for use in a Graph API URL.
 * Each segment is encoded individually so slashes are preserved.
 */
function encodeFolderPath(folderPath: string): string {
  return folderPath
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/')
}

/**
 * Recursively enumerate all files in a SharePoint folder.
 * @param driveIdOverride - optional explicit drive ID (skips site lookup)
 */
export async function* enumerateFiles(
  hostname: string,
  sitePath: string,
  folderPath: string | null,
  driveIdOverride?: string,
): AsyncGenerator<SharePointFile> {
  const driveId = await resolveDriveId(hostname, sitePath, driveIdOverride)

  const basePath = folderPath
    ? `/drives/${driveId}/root:/${encodeFolderPath(folderPath)}:/children`
    : `/drives/${driveId}/root/children`

  yield* enumerateFolder(driveId, basePath)
}

async function* enumerateFolder(driveId: string, path: string): AsyncGenerator<SharePointFile> {
  let nextUrl: string | null = path

  while (nextUrl) {
    const isFullUrl: boolean = nextUrl.startsWith('http')
    let res: Response | null = null

    // Retry with backoff for rate limiting (429) and transient errors
    for (let attempt = 0; attempt < 4; attempt++) {
      res = isFullUrl
        ? await fetch(nextUrl, {
            headers: { Authorization: `Bearer ${await getGraphToken()}` },
          }).catch(() => null)
        : await graphFetch(nextUrl)

      if (res && res.status === 429) {
        const retryAfter = parseInt(res.headers.get('Retry-After') || '5', 10)
        await new Promise((r) => setTimeout(r, retryAfter * 1000))
        continue
      }
      if (res && res.status >= 500 && attempt < 3) {
        await new Promise((r) => setTimeout(r, (attempt + 1) * 2000))
        continue
      }
      break
    }

    if (!res || !res.ok) break

    const data: { value?: DriveItem[]; '@odata.nextLink'?: string } = await res.json()
    const items: DriveItem[] = data.value || []

    for (const item of items) {
      if (item.folder) {
        const subPath = `/drives/${driveId}/items/${item.id}/children`
        yield* enumerateFolder(driveId, subPath)
      } else if (item.file && item['@microsoft.graph.downloadUrl']) {
        // Extract the relative path portion after the drive root
        const rawRef = item.parentReference?.path ?? ''
        // rawRef looks like "/drives/{id}/root:/Content Marketing/Sub" — strip the drive root prefix
        const pathAfterRoot = decodeURIComponent(rawRef.replace(/^.*?root:/, '').replace(/^\//, ''))
        yield {
          id: item.id,
          name: item.name,
          size: item.size ?? 0,
          mimeType: item.file.mimeType,
          downloadUrl: item['@microsoft.graph.downloadUrl'],
          lastModified: item.lastModifiedDateTime,
          path: pathAfterRoot,
        }
      }
    }

    nextUrl = data['@odata.nextLink'] ?? null
  }
}

/**
 * Download a file from SharePoint by its download URL.
 * Streams into a Buffer with periodic progress callbacks to keep SSE alive.
 */
export async function downloadFile(
  downloadUrl: string,
  onProgress?: (bytesRead: number, totalBytes: number | null) => void,
): Promise<Buffer> {
  let res: Response | null = null

  // Retry with backoff for rate limiting and transient errors
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await fetch(downloadUrl).catch(() => null)

    if (res && res.status === 429) {
      const retryAfter = parseInt(res.headers.get('Retry-After') || '5', 10)
      await new Promise((r) => setTimeout(r, retryAfter * 1000))
      continue
    }
    if (res && res.status >= 500 && attempt < 3) {
      await new Promise((r) => setTimeout(r, (attempt + 1) * 2000))
      continue
    }
    break
  }

  if (!res || !res.ok) throw new Error(`Failed to download file: ${res?.status ?? 'network error'}`)

  // If no body stream available, fall back to simple arrayBuffer
  if (!res.body) {
    return Buffer.from(await res.arrayBuffer())
  }

  const totalBytes = res.headers.get('content-length') ? parseInt(res.headers.get('content-length')!, 10) : null

  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let bytesRead = 0
  let lastReport = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    bytesRead += value.length

    // Report progress every ~2MB to keep SSE alive
    if (onProgress && bytesRead - lastReport > 2 * 1024 * 1024) {
      onProgress(bytesRead, totalBytes)
      lastReport = bytesRead
    }
  }

  if (onProgress) onProgress(bytesRead, totalBytes)
  return Buffer.concat(chunks)
}
