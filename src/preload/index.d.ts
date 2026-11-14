import { ElectronAPI } from '@electron-toolkit/preload'

interface LMStudioModelResult {
  success: boolean
  models: string[]
  error?: string
}

interface LMStudioChatResult {
  success: boolean
  content: string
  reasoningDetected: boolean
  finishReason: string | null
  error?: string
}

interface VoyageWorld {
  shortId: string
  title: string
  description?: string
  advancedDescription?: string | null
  discordThreadUrl?: string | null
  image?: string | null
  isLocked?: boolean
  isMod?: boolean
  isUnremixable?: boolean
  tags?: string[]
  visibility?: 'private' | 'unlisted'
  initialGameState: Record<string, unknown>
  [key: string]: unknown
}

interface VoyageRevisionSummary {
  id: string
  createdAt: string
}

interface VoyageRevisionDownload {
  shortId: string
  initialGameState: Record<string, unknown>
}

interface VoyageWorldReadResult {
  success: boolean
  world?: VoyageWorld
  etag?: string | null
  error?: string
}

interface VoyageValidationIssue {
  code: string
  message: string
  path: string
}

interface VoyageDraftValidation {
  stage: 'draft'
  valid: boolean
  errors: VoyageValidationIssue[]
  warnings: VoyageValidationIssue[]
  requestId: string
}

interface VoyageDraftValidationResult {
  success: boolean
  validation?: VoyageDraftValidation
  error?: string
}

interface VoyageOperationResult {
  success: boolean
  message?: string
  error?: string
}

interface VoyageStatusResult {
  success: boolean
  configured: boolean
  encryptionAvailable: boolean
  error?: string
}


interface WorldSchemaDiagnostic {
  code: string
  severity: 'warning'
  path: string
  message: string
  evidence: string
  confidence: 'high'
}
interface WorldIndexSummary {
  schemaVersion: 4
  worldId: string
  generatedAt: string
  nodeCount: number
  complete: boolean
  rootKeys: string[]
  relationshipCount: number
  schemaDiagnostics: WorldSchemaDiagnostic[]
}
interface WorldRelationshipResult {
  matchedPath: string
  direction: 'outgoing' | 'incoming'
  node: { path: string; key: string; kind: string; preview: string; childCount: number }
  relationship: { sourcePath: string; targetPath: string; matchedValue: string; kind: 'exact-name-reference' }
}
interface WorldIndexSearchResult {
  path: string
  key: string
  kind: string
  preview: string
  childCount: number
}
interface TrackedIssue {
  id: string
  worldId: string
  source: 'voyage-validation' | 'lm-studio' | 'application' | 'user'
  severity: 'error' | 'warning' | 'notice'
  code: string
  message: string
  path: string
  status: 'open' | 'investigating' | 'fixed-pending-validation' | 'resolved' | 'false-positive'
  firstSeenAt: string
  lastSeenAt: string
  occurrences: number
  history: Array<{ at: string; action: string; detail: string }>
}


interface DraftSnapshotSummary {
  id: string
  worldId: string
  createdAt: string
  source: 'world-opened' | 'manual-checkpoint' | 'before-proposal' | 'proposal-applied' | 'draft-reset' | 'before-restore' | 'remote-saved'
  label: string
  bytes: number
  sha256: string
}

interface AppAPI {
  lmStudio: {
    listModels: () => Promise<LMStudioModelResult>
    chat: (payload: {
      model: string
      prompt: string
      maxTokens?: number
      jsonMode?: boolean
    }) => Promise<LMStudioChatResult>
  }
  workspace: {
    buildIndex: (payload: { worldId: string; gameState: Record<string, unknown> }) => Promise<{ success: boolean; index?: WorldIndexSummary; error?: string }>
    readIndex: (worldId: string) => Promise<{ success: boolean; index?: WorldIndexSummary | null; error?: string }>
    searchIndex: (payload: { worldId: string; query: string; limit?: number }) => Promise<{ success: boolean; results: WorldIndexSearchResult[]; error?: string }>
    relatedNodes: (payload: { worldId: string; paths: string[]; limit?: number }) => Promise<{ success: boolean; results: WorldRelationshipResult[]; error?: string }>
    listIssues: (worldId: string) => Promise<{ success: boolean; issues: TrackedIssue[]; error?: string }>
    recordIssue: (payload: { worldId: string; source: TrackedIssue['source']; severity: TrackedIssue['severity']; code: string; message: string; path?: string }) => Promise<{ success: boolean; issue?: TrackedIssue; error?: string }>
    createDraftSnapshot: (payload: { worldId: string; gameState: Record<string, unknown>; source: DraftSnapshotSummary['source']; label?: string }) => Promise<{ success: boolean; snapshot?: DraftSnapshotSummary; error?: string }>
    listDraftSnapshots: (worldId: string) => Promise<{ success: boolean; snapshots: DraftSnapshotSummary[]; error?: string }>
    readDraftSnapshot: (payload: { worldId: string; snapshotId: string }) => Promise<{ success: boolean; snapshot?: { summary: DraftSnapshotSummary; gameState: Record<string, unknown> }; error?: string }>
    updateIssue: (payload: { worldId: string; issueId: string; status: TrackedIssue['status']; detail?: string }) => Promise<{ success: boolean; issues?: TrackedIssue[]; error?: string }>
  }
  voyage: {
    getStatus: () => Promise<VoyageStatusResult>
    saveApiKey: (apiKey: string) => Promise<VoyageOperationResult>
    testConnection: () => Promise<VoyageOperationResult>
    listWorlds: () => Promise<{ success: boolean; worlds?: unknown; error?: string }>
    createWorld: (payload: Record<string, unknown>) => Promise<{ success: boolean; created?: unknown; error?: string }>
    duplicateWorld: (shortId: string) => Promise<{ success: boolean; duplicated?: unknown; error?: string }>
    reorderObjectKeys: (payload: { shortId: string; path: string[]; keys: string[] }) => Promise<{ success: boolean; reordered?: boolean; world?: VoyageWorld | null; etag?: string | null; refreshError?: string; error?: string }>
    listMods: () => Promise<{ success: boolean; mods?: unknown; error?: string }>
    getUsage: () => Promise<{ success: boolean; usage?: unknown; error?: string }>
    uploadWorldCover: (shortId: string) => Promise<{ success: boolean; cancelled?: boolean; imageUrl?: string; width?: number; height?: number; bytes?: number; error?: string }>
    readWorld: (shortId: string) => Promise<VoyageWorldReadResult>
    listRevisions: (shortId: string) => Promise<{ success: boolean; revisions?: VoyageRevisionSummary[]; error?: string }>
    readRevision: (payload: { shortId: string; revisionId: string }) => Promise<{ success: boolean; revision?: VoyageRevisionDownload; error?: string }>
    restoreRevision: (payload: { shortId: string; revisionId: string }) => Promise<{ success: boolean; restored?: boolean; world?: VoyageWorld | null; etag?: string | null; refreshError?: string; error?: string }>
    validateDraft: (initialGameState: Record<string, unknown>) => Promise<VoyageDraftValidationResult>
    saveWorld: (payload: { shortId: string; etag: string; world: Record<string, unknown> }) => Promise<{ success: boolean; saved?: boolean; world?: VoyageWorld | null; etag?: string | null; refreshError?: string; error?: string }>
    clearApiKey: () => Promise<VoyageOperationResult>
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: AppAPI
  }
}
