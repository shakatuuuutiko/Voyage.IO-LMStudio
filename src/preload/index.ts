import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  lmStudio: {
    listModels: () => ipcRenderer.invoke('lmstudio:list-models'),
    chat: (payload: { model: string; prompt: string; maxTokens?: number }) =>
      ipcRenderer.invoke('lmstudio:chat', payload)
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