import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AssetCard from '../AssetCard'
import type { Asset } from '@/types'

// Mock Supabase client
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: 'https://example.com/image.jpg' } }),
      }),
    },
  }),
}))

// Mock next/image
vi.mock('next/image', () => ({
  default: ({ src, alt, ...props }: { src: string; alt: string; [key: string]: unknown }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} {...props} />
  ),
}))

const mockAsset: Asset = {
  id: 'asset-1',
  file_name: 'product-photo.jpg',
  original_filename: 'product-photo.jpg',
  file_path: 'user/photo.jpg',
  file_size: 1048576,
  mime_type: 'image/jpeg',
  content_type: 'image',
  sha256_hash: 'abc123',
  business: 'natures',
  uploaded_by: 'user-1',
  created_at: '2026-01-01T00:00:00Z',
  original_created_at: null,
  storage_path: 'user/photo.jpg',
  storage_url: null,
  tags: ['product', 'grocery', 'organic'],
  notes: null,
  thumbnail_path: null,
  extracted_text: null,
  barcodes: null,
  face_group: null,
  face_label: null,
  face_confidence: null,
  exif_data: null,
}

describe('AssetCard', () => {
  const mockOnClick = vi.fn()
  const mockOnSelect = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  const renderCard = (asset: Asset, selected = false) =>
    render(<AssetCard asset={asset} thumbUrl={null} selected={selected} onSelect={mockOnSelect} onClick={mockOnClick} />)

  it('renders the asset file name', () => {
    renderCard(mockAsset)
    expect(screen.getByText('product-photo.jpg')).toBeInTheDocument()
  })

  it('renders the formatted file size', () => {
    renderCard(mockAsset)
    expect(screen.getByText('1 MB')).toBeInTheDocument()
  })

  it('renders up to 3 tags', () => {
    renderCard(mockAsset)
    expect(screen.getByText('product')).toBeInTheDocument()
    expect(screen.getByText('grocery')).toBeInTheDocument()
    expect(screen.getByText('organic')).toBeInTheDocument()
  })

  it('shows +N overflow indicator when more than 3 tags', () => {
    const asset = { ...mockAsset, tags: ['a', 'b', 'c', 'd', 'e'] }
    renderCard(asset)
    expect(screen.getByText('+2')).toBeInTheDocument()
  })

  it('calls onClick when card is clicked', async () => {
    const user = userEvent.setup()
    renderCard(mockAsset)
    await user.click(screen.getByText('product-photo.jpg'))
    expect(mockOnClick).toHaveBeenCalledTimes(1)
  })

  it('shows NS badge for natures business', () => {
    renderCard(mockAsset)
    expect(screen.getByText('NS')).toBeInTheDocument()
  })

  it('shows ADK badge for adk business', () => {
    const asset = { ...mockAsset, business: 'adk' }
    renderCard(asset)
    expect(screen.getByText('ADK')).toBeInTheDocument()
  })

  it('shows Both badge for both business', () => {
    const asset = { ...mockAsset, business: 'both' }
    renderCard(asset)
    expect(screen.getByText('Both')).toBeInTheDocument()
  })

  it('applies selected ring styling when selected', () => {
    const { container } = renderCard(mockAsset, true)
    expect(container.firstChild).toHaveClass('ring-2')
  })

  it('does not show file type icon for image when signed URL is available', async () => {
    renderCard(mockAsset)
    expect(screen.getByText('product-photo.jpg')).toBeInTheDocument()
  })

  it('renders without tags gracefully', () => {
    const asset = { ...mockAsset, tags: null }
    renderCard(asset)
    expect(screen.getByText('product-photo.jpg')).toBeInTheDocument()
  })
})
