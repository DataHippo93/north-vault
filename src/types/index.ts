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
  exif_data: Record<string, unknown> | null
  faces_scanned?: boolean
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
