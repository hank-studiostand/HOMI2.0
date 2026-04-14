// =============================================
// CORE TYPES - AI 영상 협업툴
// =============================================

export type UserRole = 'owner' | 'editor' | 'viewer'
export type AssetType = 'reference' | 't2i' | 'i2v' | 'lipsync'
export type AttemptType = 't2i' | 'i2v' | 'lipsync'
export type AttemptStatus = 'pending' | 'generating' | 'done' | 'failed'
export type SatisfactionScore = 1 | 2 | 3 | 4 | 5

// ── Project ──────────────────────────────────
export interface Project {
  id: string
  name: string
  description: string | null
  owner_id: string
  created_at: string
  updated_at: string
}

export interface ProjectMember {
  id: string
  project_id: string
  user_id: string
  role: UserRole
  email?: string
  avatar_url?: string
}

// ── Script & Scene ────────────────────────────
export interface Script {
  id: string
  project_id: string
  content: string
  created_at: string
  updated_at: string
}

export interface Scene {
  id: string
  project_id: string
  script_id: string
  scene_number: string       // e.g. "1", "1-1", "2-3"
  title: string
  content: string            // 씬 대사/지문
  order_index: number
  settings?: SceneSettings
  master_prompt?: MasterPrompt
  selected_root_asset_ids?: {
    character?: string[]
    space?: string[]
    object?: string[]
    misc?: string[]
  }
  created_at: string
  updated_at: string
}

// ── Scene Settings (for master prompt) ────────
export type EngineType = 'nanobanana' | 'midjourney' | 'stable-diffusion' | 'dalle'
export type AngleType = 'eye-level' | 'low-angle' | 'high-angle' | 'birds-eye' | 'dutch-angle' | 'overhead'
export type LensType = 'wide' | 'standard' | 'telephoto' | 'fisheye' | 'macro' | 'anamorphic'

export interface ObjectPosition {
  id: string
  name: string
  position: 'left' | 'center' | 'right' | 'foreground' | 'background' | 'custom'
  description: string
}

export interface SceneSettings {
  id: string
  scene_id: string
  engine: EngineType
  angle: AngleType
  lens: LensType
  object_count: number
  object_positions: ObjectPosition[]
  mood: string
  lighting: string
  notes: string
  updated_at: string
}

// ── Master Prompt ─────────────────────────────
export interface MasterPrompt {
  id: string
  scene_id: string
  content: string
  negative_prompt: string
  version: number
  created_at: string
}

// ── Asset Library ─────────────────────────────
export interface Asset {
  id: string
  project_id: string
  scene_id: string | null
  type: AssetType
  name: string
  url: string
  thumbnail_url: string | null
  satisfaction_score: SatisfactionScore | null
  tags: string[]
  metadata: AssetMetadata
  archived: boolean
  attempt_id: string | null
  created_at: string
}

export interface AssetMetadata {
  width?: number
  height?: number
  duration?: number       // for video
  file_size?: number
  mime_type?: string
  engine?: string
  prompt?: string
}

// ── Prompt Attempt Tree ───────────────────────
export interface PromptAttempt {
  id: string
  scene_id: string
  parent_id: string | null   // null = root attempt
  type: AttemptType
  prompt: string
  negative_prompt: string
  engine: string
  status: AttemptStatus
  outputs: AttemptOutput[]
  children?: PromptAttempt[]
  depth: number
  created_at: string
}

export interface AttemptOutput {
  id: string
  attempt_id: string
  asset_id: string
  url: string
  thumbnail_url: string | null
  satisfaction_score: SatisfactionScore | null
  archived: boolean
  created_at: string
}

// ── Root Asset Seeds ──────────────────────────
export type RootAssetCategory = 'character' | 'space' | 'object' | 'misc'

export interface RootAssetSeed {
  id: string
  project_id: string
  category: RootAssetCategory
  name: string
  description: string | null
  reference_image_urls: string[]
  created_at: string
  updated_at: string
}

// ── Archive & Download ────────────────────────
export interface ArchiveSelection {
  asset_ids: string[]
  project_id: string
}
