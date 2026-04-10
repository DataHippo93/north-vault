export type ContentType = 'image' | 'video' | 'pdf' | 'document' | 'adobe' | 'other'
export type BusinessEntity = 'natures' | 'adk' | 'both'

export interface Asset {
  id: string
  file_name: string
  original_filename: string
  file_path: string
  file_size: number
  mime_type: string
  content_type: string
  sha256_hash: string
  business: string
  uploaded_by: string | null
  created_at: string
  original_created_at: string | null
  storage_path: string
  storage_url: string | null
  tags: string[] | null
  notes: string | null
  thumbnail_path: string | null
  extracted_text: string[] | null
  barcodes: string[] | null
  face_group: string | null
  face_label: string | null
  face_confidence: number | null
  people_indexed_at?: string | null
  exif_data: Record<string, unknown> | null
  faces_scanned?: boolean
}

export interface FaceGroup {
  id: string
  slug: string
  display_name: string | null
  centroid: number[]
  face_count: number
  image_count: number
  representative_asset_id: string | null
  representative_face_index: number | null
  representative_face_confidence: number | null
  created_at: string
  updated_at: string
}

export interface AssetFace {
  id: string
  asset_id: string
  face_group_id: string
  face_index: number
  bounding_box: {
    left: number
    top: number
    width: number
    height: number
  }
  embedding: number[]
  confidence: number
  created_at: string
}

export interface UploadFile {
  file: File
  status: 'pending' | 'hashing' | 'checking' | 'uploading' | 'tagging' | 'done' | 'duplicate' | 'error'
  progress: number
  hash?: string
  assetId?: string
  duplicateOf?: { id: string; file_name: string }
  error?: string
  aiTags?: string[]
  folderTags?: string[]
}

export interface SearchFilters {
  query: string
  contentTypes: ContentType[]
  businessEntity: BusinessEntity | 'all'
  tags: string[]
  dateFrom?: string
  dateTo?: string
}

export interface Collection {
  id: string
  name: string
  description: string | null
  business: string | null
  created_at: string
  created_by: string | null
}

export interface Person {
  id: string
  name: string | null
  representative_face_id: string | null
  face_count: number
  created_at: string
  updated_at: string
  /** Joined for display */
  crop_url?: string
}

export interface Face {
  id: string
  asset_id: string
  person_id: string | null
  box_x: number
  box_y: number
  box_width: number
  box_height: number
  confidence: number
  crop_path: string | null
}

export interface Profile {
  id: string
  email: string | null
  name: string | null
  role: string
  business: string | null
  created_at: string
}

export type SocialPlatform = 'meta' | 'instagram' | 'tiktok'

export interface SocialConnection {
  id: string
  platform: SocialPlatform
  business: string
  account_id: string
  account_name: string | null
  token_expires_at: string | null
  scopes: string[] | null
  connected_by: string
  created_at: string
  updated_at: string
}

export interface SocialCreative {
  id: string
  asset_id: string
  connection_id: string
  platform: SocialPlatform
  platform_creative_id: string
  platform_ad_id: string | null
  platform_adset_id: string | null
  platform_campaign_id: string | null
  platform_campaign_name: string | null
  creative_url: string | null
  creative_metadata: Record<string, unknown> | null
  created_at: string
}

export interface SocialMetric {
  id: string
  creative_id: string
  date: string
  impressions: number
  clicks: number
  spend_cents: number
  conversions: number
  video_views: number
  reach: number
  engagement: number
  ctr: number
  cpm_cents: number
  cpc_cents: number
  fetched_at: string
}
