import { app, safeStorage } from 'electron'
import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises'
import { join } from 'path'

const KEY_FILE_NAME = 'voyage-api-key.enc'

function getKeyFilePath(): string {
  return join(app.getPath('userData'), KEY_FILE_NAME)
}

export function isVoyageCredentialEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

export async function saveVoyageApiKey(apiKey: string): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'El cifrado seguro del sistema no está disponible. No se guardará la API Key.'
    )
  }

  const encrypted = safeStorage.encryptString(apiKey).toString('base64')
  const directory = app.getPath('userData')
  const filePath = getKeyFilePath()
  const temporaryPath = `${filePath}.tmp`

  await mkdir(directory, { recursive: true })
  await writeFile(temporaryPath, encrypted, { encoding: 'utf8', mode: 0o600 })
  await rename(temporaryPath, filePath)
}

export async function readVoyageApiKey(): Promise<string | null> {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('El cifrado seguro del sistema no está disponible.')
    }

    const encrypted = await readFile(getKeyFilePath(), 'utf8')
    if (!encrypted.trim()) return null

    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return null
    throw error
  }
}

export async function deleteVoyageApiKey(): Promise<void> {
  await rm(getKeyFilePath(), { force: true })
}
