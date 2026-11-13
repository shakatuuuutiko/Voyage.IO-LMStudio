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

interface AppAPI {
  lmStudio: {
    listModels: () => Promise<LMStudioModelResult>
    chat: (payload: {
      model: string
      prompt: string
      maxTokens?: number
    }) => Promise<LMStudioChatResult>
  }
  voyage: {
    getStatus: () => Promise<VoyageStatusResult>
    saveApiKey: (apiKey: string) => Promise<VoyageOperationResult>
    testConnection: () => Promise<VoyageOperationResult>
    readWorld: (shortId: string) => Promise<VoyageWorldReadResult>
    clearApiKey: () => Promise<VoyageOperationResult>
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: AppAPI
  }
}
