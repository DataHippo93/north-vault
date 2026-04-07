import { describe, it, expect } from 'vitest'
import { getContentType, formatFileSize, contentTypeIcon } from '../fileType'

describe('getContentType', () => {
  it('returns image for image/* MIME types', () => {
    expect(getContentType('image/jpeg')).toBe('image')
    expect(getContentType('image/png')).toBe('image')
    expect(getContentType('image/webp')).toBe('image')
    expect(getContentType('image/svg+xml')).toBe('image')
  })

  it('returns video for video/* MIME types', () => {
    expect(getContentType('video/mp4')).toBe('video')
    expect(getContentType('video/quicktime')).toBe('video')
    expect(getContentType('video/webm')).toBe('video')
  })

  it('returns pdf for application/pdf', () => {
    expect(getContentType('application/pdf')).toBe('pdf')
  })

  it('returns document for office formats', () => {
    expect(getContentType('application/msword')).toBe('document')
    expect(getContentType('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('document')
    expect(getContentType('text/plain')).toBe('document')
  })

  it('returns adobe for Photoshop/Illustrator types', () => {
    expect(getContentType('image/vnd.adobe.photoshop')).toBe('adobe')
    expect(getContentType('application/illustrator')).toBe('adobe')
  })

  it('falls back to extension when MIME is unknown', () => {
    expect(getContentType('application/octet-stream', 'photo.jpg')).toBe('image')
    expect(getContentType('application/octet-stream', 'video.mp4')).toBe('video')
    expect(getContentType('application/octet-stream', 'design.psd')).toBe('adobe')
    expect(getContentType('application/octet-stream', 'document.docx')).toBe('document')
  })

  it('falls back to MIME prefix for unknown types', () => {
    expect(getContentType('image/x-unknown-format')).toBe('image')
    expect(getContentType('video/x-custom')).toBe('video')
  })

  it('returns other for truly unknown types', () => {
    expect(getContentType('application/x-unknown')).toBe('other')
    expect(getContentType('', 'noextension')).toBe('other')
  })
})

describe('formatFileSize', () => {
  it('formats zero bytes', () => {
    expect(formatFileSize(0)).toBe('0 B')
  })

  it('formats bytes under 1KB', () => {
    expect(formatFileSize(512)).toBe('512 B')
  })

  it('formats kilobytes', () => {
    expect(formatFileSize(1024)).toBe('1 KB')
    expect(formatFileSize(1536)).toBe('1.5 KB')
  })

  it('formats megabytes', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1 MB')
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5 MB')
  })

  it('formats gigabytes', () => {
    expect(formatFileSize(1024 * 1024 * 1024)).toBe('1 GB')
  })
})

describe('contentTypeIcon', () => {
  it('returns correct emoji for each content type', () => {
    expect(contentTypeIcon('image')).toBe('🖼')
    expect(contentTypeIcon('video')).toBe('🎥')
    expect(contentTypeIcon('pdf')).toBe('📄')
    expect(contentTypeIcon('document')).toBe('📝')
    expect(contentTypeIcon('adobe')).toBe('🎨')
    expect(contentTypeIcon('other')).toBe('📁')
  })
})
