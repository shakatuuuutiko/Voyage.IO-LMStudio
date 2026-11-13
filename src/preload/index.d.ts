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
    clearApiKey: () => Promise<VoyageOperationResult>
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: AppAPI
  }
}
