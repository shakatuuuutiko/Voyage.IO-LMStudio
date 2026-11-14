import { ipcMain } from 'electron'
import {
  buildWorldIndex,
  createDraftSnapshot,
  listDraftSnapshots,
  readDraftSnapshot,
  getRelatedWorldNodes,
  listTrackedIssues,
  readWorldIndex,
  recordTrackedIssue,
  searchWorldIndex,
  updateTrackedIssue,
  type TrackedIssue
} from '../services/local-workspace-store'

export function registerLocalWorkspaceHandlers(): void {
  const channels = [
    'workspace:build-index', 'workspace:read-index', 'workspace:search-index', 'workspace:related-nodes',
    'workspace:list-issues', 'workspace:record-issue', 'workspace:update-issue',
    'workspace:create-draft-snapshot', 'workspace:list-draft-snapshots', 'workspace:read-draft-snapshot'
  ]
  channels.forEach((channel) => ipcMain.removeHandler(channel))

  ipcMain.handle('workspace:build-index', async (_event, payload: { worldId: string; gameState: Record<string, unknown> }) => {
    try {
      if (!payload || typeof payload.worldId !== 'string' || !payload.gameState ||
        typeof payload.gameState !== 'object' || Array.isArray(payload.gameState)) {
        throw new Error('Se requiere un identificador y un GameState válido.')
      }
      const index = await buildWorldIndex(payload.worldId, payload.gameState)
      return { success: true, index: { schemaVersion: index.schemaVersion, worldId: index.worldId, generatedAt: index.generatedAt, nodeCount: index.nodeCount, complete: index.complete, rootKeys: index.rootKeys, relationshipCount: index.relationshipCount, schemaDiagnostics: index.schemaDiagnostics } }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'No se pudo crear el índice.' }
    }
  })

  ipcMain.handle('workspace:read-index', async (_event, worldId: string) => {
    try {
      const index = await readWorldIndex(worldId)
      return { success: true, index: index ? { schemaVersion: index.schemaVersion, worldId: index.worldId, generatedAt: index.generatedAt, nodeCount: index.nodeCount, complete: index.complete, rootKeys: index.rootKeys, relationshipCount: index.relationshipCount, schemaDiagnostics: index.schemaDiagnostics } : null }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'No se pudo leer el índice.' }
    }
  })

  ipcMain.handle('workspace:search-index', async (_event, payload: { worldId: string; query: string; limit?: number }) => {
    try {
      const results = await searchWorldIndex(payload.worldId, payload.query, payload.limit)
      return { success: true, results }
    } catch (error) {
      return { success: false, results: [], error: error instanceof Error ? error.message : 'Falló la búsqueda.' }
    }
  })

  ipcMain.handle('workspace:related-nodes', async (_event, payload: { worldId: string; paths: string[]; limit?: number }) => {
    try {
      if (!payload || typeof payload.worldId !== 'string' || !Array.isArray(payload.paths) || payload.paths.some((path) => typeof path !== 'string')) {
        throw new Error('Se requiere el mundo y una lista de rutas válida.')
      }
      return { success: true, results: await getRelatedWorldNodes(payload.worldId, payload.paths, payload.limit) }
    } catch (error) {
      return { success: false, results: [], error: error instanceof Error ? error.message : 'No se pudieron consultar las relaciones.' }
    }
  })

  ipcMain.handle('workspace:list-issues', async (_event, worldId: string) => {
    try {
      return { success: true, issues: await listTrackedIssues(worldId) }
    } catch (error) {
      return { success: false, issues: [], error: error instanceof Error ? error.message : 'No se pudo leer el registro.' }
    }
  })

  ipcMain.handle('workspace:record-issue', async (_event, payload: Omit<TrackedIssue, 'id' | 'status' | 'firstSeenAt' | 'lastSeenAt' | 'occurrences' | 'history'>) => {
    try {
      const issue = await recordTrackedIssue(payload)
      return { success: true, issue }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'No se pudo registrar el problema.' }
    }
  })


  ipcMain.handle('workspace:create-draft-snapshot', async (_event, payload: {
    worldId: string
    gameState: Record<string, unknown>
    source: 'world-opened' | 'manual-checkpoint' | 'before-proposal' | 'proposal-applied' | 'draft-reset' | 'before-restore' | 'remote-saved'
    label?: string
  }) => {
    try {
      if (!payload || typeof payload.worldId !== 'string' || !payload.gameState ||
        typeof payload.gameState !== 'object' || Array.isArray(payload.gameState)) {
        throw new Error('Se requiere un mundo y un GameState válido.')
      }
      const snapshot = await createDraftSnapshot(payload)
      return { success: true, snapshot }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'No se pudo crear el snapshot.' }
    }
  })

  ipcMain.handle('workspace:list-draft-snapshots', async (_event, worldId: string) => {
    try {
      return { success: true, snapshots: await listDraftSnapshots(worldId) }
    } catch (error) {
      return { success: false, snapshots: [], error: error instanceof Error ? error.message : 'No se pudo leer el historial.' }
    }
  })

  ipcMain.handle('workspace:read-draft-snapshot', async (_event, payload: { worldId: string; snapshotId: string }) => {
    try {
      if (!payload || typeof payload.worldId !== 'string' || typeof payload.snapshotId !== 'string') {
        throw new Error('Se requiere el mundo y el identificador del snapshot.')
      }
      return { success: true, snapshot: await readDraftSnapshot(payload.worldId, payload.snapshotId) }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'No se pudo leer el snapshot.' }
    }
  })

  ipcMain.handle('workspace:update-issue', async (_event, payload: { worldId: string; issueId: string; status: TrackedIssue['status']; detail?: string }) => {
    try {
      const issues = await updateTrackedIssue(payload.worldId, payload.issueId, payload.status, payload.detail)
      return { success: true, issues }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'No se pudo actualizar el problema.' }
    }
  })
}
