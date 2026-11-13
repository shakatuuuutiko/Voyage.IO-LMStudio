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

interface VoyageAPI {
  lmStudio: {
    listModels: () => Promise<LMStudioModelResult>
    chat: (payload: {
      model: string
      prompt: string
      maxTokens?: number
    }) => Promise<LMStudioChatResult>
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: VoyageAPI
  }
}