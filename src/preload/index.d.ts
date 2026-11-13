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


interface WorldIndexSummary {
  schemaVersion: 2
  worldId: string
  generatedAt: string
  nodeCount: number
  complete: boolean
  rootKeys: string[]
  relationshipCount: number
}
interface WorldRelationshipResult {
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
    relatedNodes: (payload: { worldId: string; path: string; limit?: number }) => Promise<{ success: boolean; results: WorldRelationshipResult[]; error?: string }>
    listIssues: (worldId: string) => Promise<{ success: boolean; issues: TrackedIssue[]; error?: string }>
    recordIssue: (payload: { worldId: string; source: TrackedIssue['source']; severity: TrackedIssue['severity']; code: string; message: string; path?: string }) => Promise<{ success: boolean; issue?: TrackedIssue; error?: string }>
    updateIssue: (payload: { worldId: string; issueId: string; status: TrackedIssue['status']; detail?: string }) => Promise<{ success: boolean; issues?: TrackedIssue[]; error?: string }>
  }
  voyage: {
    getStatus: () => Promise<VoyageStatusResult>
    saveApiKey: (apiKey: string) => Promise<VoyageOperationResult>
    testConnection: () => Promise<VoyageOperationResult>
    listWorlds: () => Promise<{ success: boolean; worlds?: unknown; error?: string }>
    readWorld: (shortId: string) => Promise<VoyageWorldReadResult>
    validateDraft: (initialGameState: Record<string, unknown>) => Promise<VoyageDraftValidationResult>
    clearApiKey: () => Promise<VoyageOperationResult>
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: AppAPI
  }
}
