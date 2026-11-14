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
    createDraftSnapshot: (payload: { worldId: string; gameState: Record<string, unknown>; source: 'world-opened' | 'manual-checkpoint' | 'before-proposal' | 'proposal-applied' | 'draft-reset' | 'before-restore' | 'remote-saved'; label?: string }) =>
      ipcRenderer.invoke('workspace:create-draft-snapshot', payload),
    listDraftSnapshots: (worldId: string) => ipcRenderer.invoke('workspace:list-draft-snapshots', worldId),
    readDraftSnapshot: (payload: { worldId: string; snapshotId: string }) =>
      ipcRenderer.invoke('workspace:read-draft-snapshot', payload),
    updateIssue: (payload: { worldId: string; issueId: string; status: 'open' | 'investigating' | 'fixed-pending-validation' | 'resolved' | 'false-positive'; detail?: string }) =>
      ipcRenderer.invoke('workspace:update-issue', payload)
  },
  voyage: {
    getStatus: () => ipcRenderer.invoke('voyage:get-status'),
    saveApiKey: (apiKey: string) => ipcRenderer.invoke('voyage:save-api-key', apiKey),
    testConnection: () => ipcRenderer.invoke('voyage:test-connection'),
    listWorlds: () => ipcRenderer.invoke('voyage:list-worlds'),
    createWorld: (payload: Record<string, unknown>) => ipcRenderer.invoke('voyage:create-world', payload),
    duplicateWorld: (shortId: string) => ipcRenderer.invoke('voyage:duplicate-world', shortId),
    reorderObjectKeys: (payload: { shortId: string; path: string[]; keys: string[] }) => ipcRenderer.invoke('voyage:reorder-object-keys', payload),
    readWorld: (shortId: string) => ipcRenderer.invoke('voyage:read-world', shortId),
    listRevisions: (shortId: string) => ipcRenderer.invoke('voyage:list-revisions', shortId),
    readRevision: (payload: { shortId: string; revisionId: string }) => ipcRenderer.invoke('voyage:read-revision', payload),
    restoreRevision: (payload: { shortId: string; revisionId: string }) => ipcRenderer.invoke('voyage:restore-revision', payload),
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