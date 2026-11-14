import { dialog, ipcMain, nativeImage } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
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
  ipcMain.removeHandler('voyage:upload-world-cover')
  ipcMain.removeHandler('voyage:upload-item-image')


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


  ipcMain.handle('voyage:upload-world-cover', async (_event, shortId: unknown) => {
    try {
      if (typeof shortId !== 'string' || !shortId.trim()) throw new Error('Abre primero un mundo para seleccionar su portada.')
      const selection = await dialog.showOpenDialog({
        title: 'Seleccionar portada del mundo',
        properties: ['openFile'],
        filters: [{ name: 'Imágenes compatibles', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
      })
      if (selection.canceled || selection.filePaths.length === 0) return { success: false, cancelled: true }

      const filePath = selection.filePaths[0]
      const extension = extname(filePath).toLocaleLowerCase()
      const mimeByExtension: Record<string, 'image/png' | 'image/jpeg' | 'image/webp'> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp'
      }
      const mimeType = mimeByExtension[extension]
      if (!mimeType) throw new Error('Formato no compatible. Usa PNG, JPG o WebP.')
      const fileInfo = await stat(filePath)
      if (!fileInfo.isFile() || fileInfo.size < 1 || fileInfo.size > 5 * 1024 * 1024) {
        throw new Error('La imagen debe ser un archivo válido de hasta 5 MiB.')
      }
      const bytes = await readFile(filePath)
      const hasPngSignature = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      const hasJpegSignature = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      const hasWebpSignature = bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
      if ((mimeType === 'image/png' && !hasPngSignature) ||
        (mimeType === 'image/jpeg' && !hasJpegSignature) ||
        (mimeType === 'image/webp' && !hasWebpSignature)) {
        throw new Error('La extensión del archivo no coincide con su contenido real.')
      }
      const decoded = nativeImage.createFromPath(filePath)
      if (decoded.isEmpty()) throw new Error('Electron no pudo decodificar la imagen seleccionada.')
      const { width, height } = decoded.getSize()
      if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
        throw new Error('No se pudieron determinar las dimensiones de la imagen.')
      }
      const apiKey = await readVoyageApiKey()
      if (!apiKey) throw new Error('Primero guarda tu API Key de Voyage.')
      const result = await new VoyageCreatorClient(apiKey).uploadAndModerateWorldCover(
        shortId, bytes, width, height, mimeType
      )
      return { success: true, imageUrl: result.imageUrl, width, height, bytes: fileInfo.size }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('voyage:upload-item-image', async (_event, payload: unknown) => {
    try {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Selecciona un mundo y un objeto válido.')
      const input = payload as Record<string, unknown>
      if (typeof input.shortId !== 'string' || !input.shortId.trim()) throw new Error('Abre primero un mundo.')
      if (typeof input.itemKey !== 'string' || !input.itemKey.trim() || input.itemKey.length > 256) {
        throw new Error('La clave del objeto no es válida.')
      }
      const selection = await dialog.showOpenDialog({
        title: 'Seleccionar imagen del objeto',
        properties: ['openFile'],
        filters: [{ name: 'Imágenes compatibles', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
      })
      if (selection.canceled || selection.filePaths.length === 0) return { success: false, cancelled: true }

      const filePath = selection.filePaths[0]
      const extension = extname(filePath).toLocaleLowerCase()
      const mimeByExtension: Record<string, 'image/png' | 'image/jpeg' | 'image/webp'> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp'
      }
      const mimeType = mimeByExtension[extension]
      if (!mimeType) throw new Error('Formato no compatible. Usa PNG, JPG o WebP.')
      const fileInfo = await stat(filePath)
      if (!fileInfo.isFile() || fileInfo.size < 1 || fileInfo.size > 5 * 1024 * 1024) {
        throw new Error('La imagen debe ser un archivo válido de hasta 5 MiB.')
      }
      const bytes = await readFile(filePath)
      const hasPngSignature = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      const hasJpegSignature = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      const hasWebpSignature = bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
      if ((mimeType === 'image/png' && !hasPngSignature) ||
        (mimeType === 'image/jpeg' && !hasJpegSignature) ||
        (mimeType === 'image/webp' && !hasWebpSignature)) {
        throw new Error('La extensión del archivo no coincide con su contenido real.')
      }
      const decoded = nativeImage.createFromPath(filePath)
      if (decoded.isEmpty()) throw new Error('Electron no pudo decodificar la imagen seleccionada.')
      const { width, height } = decoded.getSize()
      if (!Number.isInteger(width) || !Number.isInteger(height) || width < 600 || height < 600) {
        throw new Error('Las imágenes de objetos deben medir al menos 600 × 600 píxeles.')
      }
      const apiKey = await readVoyageApiKey()
      if (!apiKey) throw new Error('Primero guarda tu API Key de Voyage.')
      const result = await new VoyageCreatorClient(apiKey).uploadAndModerateItemImage(
        input.shortId, bytes, width, height, mimeType
      )
      return { success: true, itemKey: input.itemKey, imageUrl: result.imageUrl, width, height, bytes: fileInfo.size }
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
