import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  lmStudio: {
    listModels: () => ipcRenderer.invoke('lmstudio:list-models'),
    chat: (payload: { model: string; prompt: string; maxTokens?: number; jsonMode?: boolean }) =>
      ipcRenderer.invoke('lmstudio:chat', payload)
  },
  workspace: {
    buildIndex: (payload: { worldId: string; gameState: Record<string, unknown> }) =>
      ipcRenderer.invoke('workspace:build-index', payload),
    readIndex: (worldId: string) => ipcRenderer.invoke('workspace:read-index', worldId),
    searchIndex: (payload: { worldId: string; query: string; limit?: number }) =>
      ipcRenderer.invoke('workspace:search-index', payload),
    relatedNodes: (payload: { worldId: string; paths: string[]; limit?: number }) =>
      ipcRenderer.invoke('workspace:related-nodes', payload),
    listIssues: (worldId: string) => ipcRenderer.invoke('workspace:list-issues', worldId),
    recordIssue: (payload: { worldId: string; source: 'voyage-validation' | 'lm-studio' | 'application' | 'user'; severity: 'error' | 'warning' | 'notice'; code: string; message: string; path?: string }) =>
      ipcRenderer.invoke('workspace:record-issue', payload),
    updateIssue: (payload: { worldId: string; issueId: string; status: 'open' | 'investigating' | 'fixed-pending-validation' | 'resolved' | 'false-positive'; detail?: string }) =>
      ipcRenderer.invoke('workspace:update-issue', payload)
  },
  voyage: {
    getStatus: () => ipcRenderer.invoke('voyage:get-status'),
    saveApiKey: (apiKey: string) => ipcRenderer.invoke('voyage:save-api-key', apiKey),
    testConnection: () => ipcRenderer.invoke('voyage:test-connection'),
    listWorlds: () => ipcRenderer.invoke('voyage:list-worlds'),
    readWorld: (shortId: string) => ipcRenderer.invoke('voyage:read-world', shortId),
    validateDraft: (initialGameState: Record<string, unknown>) =>
      ipcRenderer.invoke('voyage:validate-draft', initialGameState),
    saveWorld: (payload: { shortId: string; etag: string; world: Record<string, unknown> }) =>
      ipcRenderer.invoke('voyage:save-world', payload),
    clearApiKey: () => ipcRenderer.invoke('voyage:clear-api-key')
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.electron = electronAPI
  // @ts-ignore
  window.api = api
}