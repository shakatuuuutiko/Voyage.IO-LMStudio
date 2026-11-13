import { app } from 'electron'
import { access, rename } from 'fs/promises'
import { join, resolve } from 'path'

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * Keep existing API credentials, world indexes, and issue history when the
 * packaged product is renamed. The package name remains "voyage-io" in dev,
 * so that folder is also a migration source for packaged installs.
 */
export async function migrateUserDataDirectory(): Promise<void> {
  const currentDirectory = app.getPath('userData')
  if (await pathExists(currentDirectory)) return

  const appDataDirectory = app.getPath('appData')
  const legacyDirectoryNames = ['Voyage AI Companion', 'voyage-io', 'voyage-ai-companion']

  for (const legacyName of legacyDirectoryNames) {
    const legacyDirectory = join(appDataDirectory, legacyName)
    if (resolve(legacyDirectory).toLocaleLowerCase() === resolve(currentDirectory).toLocaleLowerCase()) continue
    if (!(await pathExists(legacyDirectory))) continue

    try {
      await rename(legacyDirectory, currentDirectory)
      return
    } catch (error) {
      // Do not silently create a fresh profile if legacy data could not be moved.
      throw new Error(
        'No se pudo migrar el almacenamiento local anterior de VoyAgent: ' +
        (error instanceof Error ? error.message : 'error desconocido')
      )
    }
  }
}
