import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  lmStudio: {
    listModels: () => ipcRenderer.invoke('lmstudio:list-models'),
    chat: (payload: { model: string; prompt: string; maxTokens?: number }) =>
      ipcRenderer.invoke('lmstudio:chat', payload)
  },
  voyage: {
    getStatus: () => ipcRenderer.invoke('voyage:get-status'),
    saveApiKey: (apiKey: string) => ipcRenderer.invoke('voyage:save-api-key', apiKey),
    testConnection: () => ipcRenderer.invoke('voyage:test-connection'),
    listWorlds: () => ipcRenderer.invoke('voyage:list-worlds'),
    readWorld: (shortId: string) => ipcRenderer.invoke('voyage:read-world', shortId),
    validateDraft: (initialGameState: Record<string, unknown>) =>
      ipcRenderer.invoke('voyage:validate-draft', initialGameState),
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