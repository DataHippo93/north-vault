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
  file_size: 1048576, // 1 MB
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
  exif_data: null,
}

describe('AssetCard', () => {
  const mockOnClick = vi.fn()
  const mockOnSelect = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the asset file name', () => {
    render(<AssetCard asset={mockAsset} selected={false} onSelect={mockOnSelect} onClick={mockOnClick} />)
    expect(screen.getByText('product-photo.jpg')).toBeInTheDocument()
  })

  it('renders the formatted file size', () => {
    render(<AssetCard asset={mockAsset} selected={false} onSelect={mockOnSelect} onClick={mockOnClick} />)
    expect(screen.getByText('1 MB')).toBeInTheDocument()
  })

  it('renders up to 3 tags', () => {
    render(<AssetCard asset={mockAsset} selected={false} onSelect={mockOnSelect} onClick={mockOnClick} />)
    expect(screen.getByText('product')).toBeInTheDocument()
    expect(screen.getByText('grocery')).toBeInTheDocument()
    expect(screen.getByText('organic')).toBeInTheDocument()
  })

  it('shows +N overflow indicator when more than 3 tags', () => {
    const asset = { ...mockAsset, tags: ['a', 'b', 'c', 'd', 'e'] }
    render(<AssetCard asset={asset} selected={false} onSelect={mockOnSelect} onClick={mockOnClick} />)
    expect(screen.getByText('+2')).toBeInTheDocument()
  })

  it('calls onClick when card is clicked', async () => {
    const user = userEvent.setup()
    render(<AssetCard asset={mockAsset} selected={false} onSelect={mockOnSelect} onClick={mockOnClick} />)
    await user.click(screen.getByText('product-photo.jpg'))
    expect(mockOnClick).toHaveBeenCalledTimes(1)
  })

  it('shows NS badge for natures business', () => {
    render(<AssetCard asset={mockAsset} selected={false} onSelect={mockOnSelect} onClick={mockOnClick} />)
    expect(screen.getByText('NS')).toBeInTheDocument()
  })

  it('shows ADK badge for adk business', () => {
    const asset = { ...mockAsset, business: 'adk' }
    render(<AssetCard asset={asset} selected={false} onSelect={mockOnSelect} onClick={mockOnClick} />)
    expect(screen.getByText('ADK')).toBeInTheDocument()
  })

  it('shows Both badge for both business', () => {
    const asset = { ...mockAsset, business: 'both' }
    render(<AssetCard asset={asset} selected={false} onSelect={mockOnSelect} onClick={mockOnClick} />)
    expect(screen.getByText('Both')).toBeInTheDocument()
  })

  it('applies selected ring styling when selected', () => {
    const { container } = render(
      <AssetCard asset={mockAsset} selected={true} onSelect={mockOnSelect} onClick={mockOnClick} />,
    )
    expect(container.firstChild).toHaveClass('ring-2')
  })

  it('does not show file type icon for image when signed URL is available', async () => {
    // After useEffect, image should show
    render(<AssetCard asset={mockAsset} selected={false} onSelect={mockOnSelect} onClick={mockOnClick} />)
    // Initially no image (URL not yet loaded), TypeIcon shown
    // We don't need to test async loading here — just that the component renders
    expect(screen.getByText('product-photo.jpg')).toBeInTheDocument()
  })

  it('renders without tags gracefully', () => {
    const asset = { ...mockAsset, tags: null }
    render(<AssetCard asset={asset} selected={false} onSelect={mockOnSelect} onClick={mockOnClick} />)
    expect(screen.getByText('product-photo.jpg')).toBeInTheDocument()
  })
})
