import { ipcMain } from 'electron'
import { VoyageCreatorClient } from '../services/voyage/client'
import {
  deleteVoyageApiKey,
  isVoyageCredentialEncryptionAvailable,
  readVoyageApiKey,
  saveVoyageApiKey
} from '../services/voyage/secure-store'

const API_KEY_PREFIX = 'sk-voyage-v1-'

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Error desconocido.'
}

export function registerVoyageIpcHandlers(): void {
  ipcMain.removeHandler('voyage:get-status')
  ipcMain.removeHandler('voyage:save-api-key')
  ipcMain.removeHandler('voyage:test-connection')
  ipcMain.removeHandler('voyage:clear-api-key')

  ipcMain.handle('voyage:get-status', async () => {
    try {
      const encryptionAvailable = isVoyageCredentialEncryptionAvailable()
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
        encryptionAvailable: isVoyageCredentialEncryptionAvailable(),
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

  ipcMain.handle('voyage:clear-api-key', async () => {
    try {
      await deleteVoyageApiKey()
      return { success: true }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  })
}
