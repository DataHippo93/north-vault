export type ContentType = 'image' | 'video' | 'pdf' | 'document' | 'adobe' | 'other'

const MIME_MAP: Record<string, ContentType> = {
  // Images
  'image/jpeg': 'image',
  'image/jpg': 'image',
  'image/png': 'image',
  'image/gif': 'image',
  'image/webp': 'image',
  'image/svg+xml': 'image',
  'image/tiff': 'image',
  'image/bmp': 'image',
  'image/heic': 'image',
  'image/heif': 'image',

  // Videos
  'video/mp4': 'video',
  'video/quicktime': 'video',
  'video/x-msvideo': 'video',
  'video/mpeg': 'video',
  'video/webm': 'video',
  'video/ogg': 'video',
  'video/3gpp': 'video',

  // PDF
  'application/pdf': 'pdf',

  // Documents
  'application/msword': 'document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
  'application/vnd.ms-excel': 'document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'document',
  'application/vnd.ms-powerpoint': 'document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'document',
  'text/plain': 'document',
  'text/csv': 'document',
  'application/rtf': 'document',

  // Adobe
  'image/vnd.adobe.photoshop': 'adobe',
  'application/postscript': 'adobe',
  'application/illustrator': 'adobe',
  'application/x-indesign': 'adobe',
  'application/vnd.adobe.xd': 'adobe',
}

const EXTENSION_MAP: Record<string, ContentType> = {
  // Images
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image',
  svg: 'image', tiff: 'image', tif: 'image', bmp: 'image', heic: 'image', heif: 'image',
  // Videos
  mp4: 'video', mov: 'video', avi: 'video', mpeg: 'video', mpg: 'video',
  webm: 'video', ogv: 'video', '3gp': 'video', mkv: 'video',
  // PDF
  pdf: 'pdf',
  // Documents
  doc: 'document', docx: 'document', xls: 'document', xlsx: 'document',
  ppt: 'document', pptx: 'document', txt: 'document', csv: 'document', rtf: 'document',
  // Adobe
  psd: 'adobe', ai: 'adobe', eps: 'adobe', indd: 'adobe', xd: 'adobe', psb: 'adobe',
}

export function getContentType(mimeType: string, fileName?: string): ContentType {
  // Try MIME type first
  const fromMime = MIME_MAP[mimeType.toLowerCase()]
  if (fromMime) return fromMime

  // Fall back to extension
  if (fileName) {
    const ext = fileName.split('.').pop()?.toLowerCase()
    if (ext && EXTENSION_MAP[ext]) return EXTENSION_MAP[ext]
  }

  // Fallback by MIME prefix
  const prefix = mimeType.split('/')[0]
  if (prefix === 'image') return 'image'
  if (prefix === 'video') return 'video'
  if (prefix === 'audio') return 'other'

  return 'other'
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

export function contentTypeIcon(type: ContentType): string {
  const icons: Record<ContentType, string> = {
    image: '🖼',
    video: '🎥',
    pdf: '📄',
    document: '📝',
    adobe: '🎨',
    other: '📁',
  }
  return icons[type]
}
