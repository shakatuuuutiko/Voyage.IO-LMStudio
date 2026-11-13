import { app, safeStorage } from 'electron'
import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises'
import { join } from 'path'

const KEY_FILE_NAME = 'voyage-api-key.enc'

function getKeyFilePath(): string {
  return join(app.getPath('userData'), KEY_FILE_NAME)
}

export async function isVoyageCredentialEncryptionAvailable(): Promise<boolean> {
  return safeStorage.isAsyncEncryptionAvailable()
}

async function writeEncryptedKey(encrypted: Buffer): Promise<void> {
  const directory = app.getPath('userData')
  const filePath = getKeyFilePath()
  const temporaryPath = `${filePath}.tmp`

  await mkdir(directory, { recursive: true })
  await writeFile(temporaryPath, encrypted.toString('base64'), {
    encoding: 'utf8',
    mode: 0o600
  })
  await rename(temporaryPath, filePath)
}

export async function saveVoyageApiKey(apiKey: string): Promise<void> {
  if (!(await isVoyageCredentialEncryptionAvailable())) {
    throw new Error(
      'El almacenamiento cifrado del sistema no está disponible. No se guardará la API Key.'
    )
  }

  const encrypted = await safeStorage.encryptStringAsync(apiKey)
  await writeEncryptedKey(encrypted)
}

export async function readVoyageApiKey(): Promise<string | null> {
  if (!(await isVoyageCredentialEncryptionAvailable())) {
    throw new Error('El almacenamiento cifrado del sistema no está disponible.')
  }

  try {
    const encryptedText = await readFile(getKeyFilePath(), 'utf8')
    if (!encryptedText.trim()) return null

    const encrypted = Buffer.from(encryptedText, 'base64')
    const decrypted = await safeStorage.decryptStringAsync(encrypted)

    if (decrypted.shouldReEncrypt) {
      const refreshed = await safeStorage.encryptStringAsync(decrypted.result)
      await writeEncryptedKey(refreshed)
    }

    return decrypted.result
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return null
    throw error
  }
}

export async function deleteVoyageApiKey(): Promise<void> {
  await rm(getKeyFilePath(), { force: true })
}
