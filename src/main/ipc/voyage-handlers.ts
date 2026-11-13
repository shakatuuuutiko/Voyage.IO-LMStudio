import { ipcMain } from 'electron'
import { VoyageApiError, VoyageCreatorClient } from '../services/voyage/client'
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
  ipcMain.removeHandler('voyage:list-worlds')

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
