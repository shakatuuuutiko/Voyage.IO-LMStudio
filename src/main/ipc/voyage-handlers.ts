import { ipcMain } from 'electron'
import { VoyageApiError, VoyageCreatorClient } from '../services/voyage/client'
import type { EditableWorld } from '../services/voyage/types'
import {
  deleteVoyageApiKey,
  isVoyageCredentialEncryptionAvailable,
  readVoyageApiKey,
  saveVoyageApiKey
} from '../services/voyage/secure-store'

const API_KEY_PREFIX = 'sk-voyage-v1-'

function redactCredential(value: string): string {
  return value.replace(/sk-voyage-v1-[^\s"'<>]+/g, 'sk-voyage-v1-[REDACTED]')
}

function getErrorMessage(error: unknown): string {
  if (error instanceof VoyageApiError) {
    const { status, code, requestId, retryAfterSeconds } = error.details
    const details = [
      `HTTP ${status}`,
      code,
      requestId ? `requestId: ${requestId}` : undefined,
      retryAfterSeconds !== undefined ? `reintentar en ${retryAfterSeconds}s` : undefined
    ].filter(Boolean)

    return redactCredential(`${details.join(' · ')} — ${error.message}`)
  }

  return redactCredential(error instanceof Error ? error.message : 'Error desconocido.')
}

export function registerVoyageIpcHandlers(): void {
  ipcMain.removeHandler('voyage:get-status')
  ipcMain.removeHandler('voyage:save-api-key')
  ipcMain.removeHandler('voyage:test-connection')
  ipcMain.removeHandler('voyage:clear-api-key')
  ipcMain.removeHandler('voyage:read-world')
  ipcMain.removeHandler('voyage:validate-draft')
  ipcMain.removeHandler('voyage:save-world')
  ipcMain.removeHandler('voyage:list-worlds')
  ipcMain.removeHandler('voyage:list-revisions')
  ipcMain.removeHandler('voyage:read-revision')
  ipcMain.removeHandler('voyage:restore-revision')
  ipcMain.removeHandler('voyage:create-world')
  ipcMain.removeHandler('voyage:duplicate-world')
  ipcMain.removeHandler('voyage:reorder-object-keys')
  ipcMain.removeHandler('voyage:list-mods')
  ipcMain.removeHandler('voyage:get-usage')


  ipcMain.handle('voyage:list-mods', async () => {
    try {
      const apiKey = await readVoyageApiKey()
      if (!apiKey) throw new Error('Primero guarda tu API Key de Voyage.')
      const mods = await new VoyageCreatorClient(apiKey).listMods()
      return { success: true, mods }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('voyage:get-usage', async () => {
    try {
      const apiKey = await readVoyageApiKey()
      if (!apiKey) throw new Error('Primero guarda tu API Key de Voyage.')
      const usage = await new VoyageCreatorClient(apiKey).getUsage()
      return { success: true, usage }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('voyage:get-status', async () => {
    try {
      const encryptionAvailable = await isVoyageCredentialEncryptionAvailable()
      const apiKey = await readVoyageApiKey()
      return {
        success: true,
        configured: Boolean(apiKey),
        encryptionAvailable
      }
    } catch (error) {
      return {
        success: false,
        configured: false,
        encryptionAvailable: await isVoyageCredentialEncryptionAvailable().catch(() => false),
        error: getErrorMessage(error)
      }
    }
  })

  ipcMain.handle('voyage:save-api-key', async (_event, value: unknown) => {
    try {
      if (typeof value !== 'string' || !value.trim()) {
        throw new Error('Introduce una API Key.')
      }

      const apiKey = value.trim()
      if (
        !apiKey.startsWith(API_KEY_PREFIX) ||
        apiKey.length <= API_KEY_PREFIX.length ||
        apiKey.length > 1024
      ) {
        throw new Error('El formato no coincide con una Player API Key de Voyage.')
      }

      await saveVoyageApiKey(apiKey)
      return { success: true, message: 'API Key guardada de forma cifrada.' }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('voyage:test-connection', async () => {
    try {
      const apiKey = await readVoyageApiKey()
      if (!apiKey) {
        throw new Error('Primero guarda tu API Key de Voyage.')
      }

      const result = await new VoyageCreatorClient(apiKey).testConnection()
      return { success: true, message: result.message }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('voyage:create-world', async (_event, payload: unknown) => {
    try {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Introduce los datos del nuevo mundo.')
      const input = payload as Record<string, unknown>
      if (typeof input.title !== 'string' || !input.title.trim()) throw new Error('El título del mundo es obligatorio.')
      if (!input.initialGameState || typeof input.initialGameState !== 'object' || Array.isArray(input.initialGameState)) {
        throw new Error('El GameState inicial debe ser un objeto JSON.')
      }
      const apiKey = await readVoyageApiKey()
      if (!apiKey) throw new Error('Primero guarda tu API Key de Voyage.')
      const created = await new VoyageCreatorClient(apiKey).createWorld(input as unknown as import('../services/voyage/client').CreateVoyageWorldInput)
      return { success: true, created }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('voyage:duplicate-world', async (_event, shortId: unknown) => {
    try {
      if (typeof shortId !== 'string') throw new Error('Selecciona un mundo para duplicar.')
      const apiKey = await readVoyageApiKey()
      if (!apiKey) throw new Error('Primero guarda tu API Key de Voyage.')
      const duplicated = await new VoyageCreatorClient(apiKey).duplicateWorld(shortId)
      return { success: true, duplicated }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  })


  ipcMain.handle('voyage:reorder-object-keys', async (_event, payload: unknown) => {
    try {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Se requieren el mundo, la ruta del objeto y las claves.')
      const input = payload as Record<string, unknown>
      if (typeof input.shortId !== 'string' || !Array.isArray(input.path) || !Array.isArray(input.keys)) {
        throw new Error('Los datos de reordenamiento no tienen un formato válido.')
      }
      const apiKey = await readVoyageApiKey()
      if (!apiKey) throw new Error('Primero guarda tu API Key de Voyage.')
      const result = await new VoyageCreatorClient(apiKey).reorderWorldObjectKeys(input.shortId, input.path as string[], input.keys as string[])
      return { success: true, ...result }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('voyage:list-worlds', async () => {
    try {
      const apiKey = await readVoyageApiKey()
      if (!apiKey) throw new Error('Primero guarda tu API Key de Voyage.')
      const worlds = await new VoyageCreatorClient(apiKey).listWorlds()
      return { success: true, worlds }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('voyage:list-revisions', async (_event, shortId: unknown) => {
    try {
      if (typeof shortId !== 'string') throw new Error('Introduce el identificador del mundo.')
      const apiKey = await readVoyageApiKey()
      if (!apiKey) throw new Error('Primero guarda tu API Key de Voyage.')
      const revisions = await new VoyageCreatorClient(apiKey).listWorldRevisions(shortId)
      return { success: true, revisions }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('voyage:read-revision', async (_event, payload: { shortId: unknown; revisionId: unknown }) => {
    try {
      if (!payload || typeof payload.shortId !== 'string' || typeof payload.revisionId !== 'string') {
        throw new Error('Se requieren los identificadores del mundo y de la revisión.')
      }
      const apiKey = await readVoyageApiKey()
      if (!apiKey) throw new Error('Primero guarda tu API Key de Voyage.')
      const revision = await new VoyageCreatorClient(apiKey).readWorldRevision(payload.shortId, payload.revisionId)
      return { success: true, revision }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('voyage:restore-revision', async (_event, payload: { shortId: unknown; revisionId: unknown }) => {
    try {
      if (!payload || typeof payload.shortId !== 'string' || typeof payload.revisionId !== 'string') {
        throw new Error('Se requieren los identificadores del mundo y de la revisión.')
      }
      const apiKey = await readVoyageApiKey()
      if (!apiKey) throw new Error('Primero guarda tu API Key de Voyage.')
      const result = await new VoyageCreatorClient(apiKey).restoreWorldRevision(payload.shortId, payload.revisionId)
      return { success: true, ...result }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('voyage:read-world', async (_event, shortId: unknown) => {
    try {
      if (typeof shortId !== 'string') {
        throw new Error('Introduce el identificador del mundo.')
      }

      const apiKey = await readVoyageApiKey()
      if (!apiKey) {
        throw new Error('Primero guarda tu API Key de Voyage.')
      }

      const result = await new VoyageCreatorClient(apiKey).readWorld(shortId)
      return {
        success: true,
        world: result.world,
        etag: result.etag
      }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('voyage:save-world', async (_event, payload: { shortId: string; etag: string; world: unknown }) => {
    try {
      if (!payload || typeof payload.shortId !== 'string' || typeof payload.etag !== 'string' ||
        !payload.world || typeof payload.world !== 'object' || Array.isArray(payload.world)) {
        throw new Error('Se requiere el mundo, su ETag y un documento válido.')
      }
      const world = payload.world as Record<string, unknown>
      if (world.shortId !== payload.shortId || !world.initialGameState ||
        typeof world.initialGameState !== 'object' || Array.isArray(world.initialGameState)) {
        throw new Error('El documento debe conservar el shortId y un initialGameState válido.')
      }
      const apiKey = await readVoyageApiKey()
      if (!apiKey) throw new Error('Primero guarda tu API Key de Voyage.')
      const result = await new VoyageCreatorClient(apiKey).replaceWorld(
        payload.shortId, world as unknown as EditableWorld, payload.etag
      )
      return { success: true, ...result }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('voyage:validate-draft', async (_event, initialGameState: unknown) => {
    try {
      if (
        typeof initialGameState !== 'object' ||
        initialGameState === null ||
        Array.isArray(initialGameState)
      ) {
        throw new Error('El estado del mundo no tiene un formato válido para validar.')
      }

      const apiKey = await readVoyageApiKey()
      if (!apiKey) throw new Error('Primero guarda tu API Key de Voyage.')

      const result = await new VoyageCreatorClient(apiKey).validateDraft(
        initialGameState as Record<string, unknown>
      )
      return { success: true, validation: result }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('voyage:clear-api-key', async () => {
    try {
      await deleteVoyageApiKey()
      return { success: true }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  })
}
