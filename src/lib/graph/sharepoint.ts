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

  // Extract site path (e.g., /sites/adkfragrancefarm)
  const pathMatch = u.pathname.match(/^(\/sites\/[^/]+)/)
  if (!pathMatch) {
    throw new Error('Could not parse SharePoint site from URL. Expected /sites/<name> in path.')
  }
  const sitePath = pathMatch[1]

  // Extract folder path after "Shared Documents" or "Documents"
  const docMatch = u.pathname.match(/\/(?:Shared%20Documents|Shared Documents|Documents)\/?(.*?)(?:\/Forms\/AllItems\.aspx)?$/)
  const folderPath = docMatch?.[1]?.replace(/\/Forms\/AllItems\.aspx$/, '').replace(/%20/g, ' ') || null

  return { hostname, sitePath, folderPath }
}

/**
 * Get the drive ID for a SharePoint site's default document library.
 */
async function getDriveId(hostname: string, sitePath: string): Promise<string> {
  // First get the site ID
  const siteRes = await graphFetch(`/sites/${hostname}:${sitePath}`)
  if (!siteRes.ok) {
    const err = await siteRes.text()
    throw new Error(`Failed to get site: ${err}`)
  }
  const site = await siteRes.json()

  // Get the default drive (Shared Documents)
  const drivesRes = await graphFetch(`/sites/${site.id}/drives`)
  if (!drivesRes.ok) {
    const err = await drivesRes.text()
    throw new Error(`Failed to get drives: ${err}`)
  }
  const drives = await drivesRes.json()

  // Find "Documents" or "Shared Documents" drive
  const drive = drives.value.find((d: { name: string }) =>
    d.name === 'Documents' || d.name === 'Shared Documents'
  ) || drives.value[0]

  if (!drive) {
    throw new Error('No document library found on this site')
  }

  return drive.id
}

/**
 * Recursively enumerate all files in a SharePoint folder.
 */
export async function* enumerateFiles(
  hostname: string,
  sitePath: string,
  folderPath: string | null
): AsyncGenerator<SharePointFile> {
  const driveId = await getDriveId(hostname, sitePath)

  // Build the initial path
  const basePath = folderPath
    ? `/drives/${driveId}/root:/${encodeURIComponent(folderPath)}:/children`
    : `/drives/${driveId}/root/children`

  yield* enumerateFolder(driveId, basePath)
}

async function* enumerateFolder(
  driveId: string,
  path: string
): AsyncGenerator<SharePointFile> {
  let nextUrl: string | null = path

  while (nextUrl) {
    const isFullUrl: boolean = nextUrl.startsWith('http')
    const res: Response | null = isFullUrl
      ? await fetch(nextUrl, {
          headers: { Authorization: `Bearer ${await getGraphToken()}` }
        }).catch(() => null)
      : await graphFetch(nextUrl)

    if (!res || !res.ok) break

    const data = await res.json()
    const items: DriveItem[] = data.value || []

    for (const item of items) {
      if (item.folder) {
        // Recurse into subfolders
        const subPath = `/drives/${driveId}/items/${item.id}/children`
        yield* enumerateFolder(driveId, subPath)
      } else if (item.file && item['@microsoft.graph.downloadUrl']) {
        yield {
          id: item.id,
          name: item.name,
          size: item.size || 0,
          mimeType: item.file.mimeType,
          downloadUrl: item['@microsoft.graph.downloadUrl'],
          lastModified: item.lastModifiedDateTime,
          path: item.parentReference?.path
            ? decodeURIComponent(item.parentReference.path.replace(/^.*:/, ''))
            : '',
        }
      }
    }

    nextUrl = data['@odata.nextLink'] || null
  }
}

/**
 * Download a file from SharePoint by its download URL.
 * Returns the file as a Buffer.
 */
export async function downloadFile(downloadUrl: string): Promise<Buffer> {
  const res = await fetch(downloadUrl)
  if (!res.ok) {
    throw new Error(`Failed to download file: ${res.status}`)
  }
  const arrayBuffer = await res.arrayBuffer()
  return Buffer.from(arrayBuffer)
}
