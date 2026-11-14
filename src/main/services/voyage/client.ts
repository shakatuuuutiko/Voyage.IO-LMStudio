import { randomUUID } from 'crypto'
import type { EditableWorld, ReadWorldResult } from './types'

export const VOYAGE_API_BASE_URL = 'https://api.aidungeon.com/creator/v1'

export interface VoyageApiErrorDetails {
  status: number
  code?: string
  requestId?: string
  retryAfterSeconds?: number
}

export class VoyageApiError extends Error {
  readonly details: VoyageApiErrorDetails

  constructor(message: string, details: VoyageApiErrorDetails) {
    super(message)
    this.name = 'VoyageApiError'
    this.details = details
  }
}

interface VoyageErrorPayload {
  error?: {
    code?: string
    message?: string
  }
  requestId?: string
}

interface VoyageHttpResponse<T> {
  data: T
  headers: Headers
  status: number
}

export interface VoyageConnectionResult {
  success: true
  message: string
}

export interface CreateVoyageWorldInput {
  title: string
  description?: string | null
  advancedDescription?: string | null
  discordThreadUrl?: string | null
  image?: string | null
  initialGameState: Record<string, unknown>
  isLocked?: boolean
  isMod?: boolean
  isUnremixable?: boolean
  tags?: string[]
  visibility?: 'private' | 'unlisted'
}

export interface VoyageValidationIssue {
  code: string
  message: string
  path: string
}

export interface VoyageValidationResult {
  stage: 'draft' | 'publish'
  valid: boolean
  errors: VoyageValidationIssue[]
  warnings: VoyageValidationIssue[]
  requestId: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getRetryAfterSeconds(value: string | null): number | undefined {
  if (!value) return undefined

  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds

  const date = Date.parse(value)
  if (Number.isNaN(date)) return undefined
  return Math.max(0, Math.ceil((date - Date.now()) / 1000))
}

export class VoyageCreatorClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = VOYAGE_API_BASE_URL
  ) {}

  private async request<T>(
    path: string,
    options: { method?: 'GET' | 'POST' | 'PUT' | 'PATCH'; body?: unknown; ifMatch?: string; idempotencyKey?: string } = {}
  ): Promise<VoyageHttpResponse<T>> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: options.method || 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: 'application/json',
          ...(options.ifMatch ? { 'If-Match': options.ifMatch } : {}),
          ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
          ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {})
        },
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal
      })

      const raw = await response.text()
      let payload: unknown = null

      if (raw) {
        try {
          payload = JSON.parse(raw)
        } catch {
          payload = raw
        }
      }

      if (!response.ok) {
        const errorPayload = (isRecord(payload) ? payload : {}) as VoyageErrorPayload
        throw new VoyageApiError(
          errorPayload.error?.message || `Voyage Creator API respondió HTTP ${response.status}.`,
          {
            status: response.status,
            code: errorPayload.error?.code,
            requestId: errorPayload.requestId,
            retryAfterSeconds: getRetryAfterSeconds(response.headers.get('Retry-After'))
          }
        )
      }

      return {
        data: payload as T,
        headers: response.headers,
        status: response.status
      }
    } catch (error) {
      if (error instanceof VoyageApiError) throw error
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Tiempo de espera agotado al conectar con Voyage Creator API.')
      }
      throw new Error(
        error instanceof Error
          ? `No se pudo conectar con Voyage Creator API: ${error.message}`
          : 'No se pudo conectar con Voyage Creator API.'
      )
    } finally {
      clearTimeout(timeout)
    }
  }

  async listWorlds(): Promise<unknown> {
    // The list response is not fully described in OpenAPI; preserve it without guessing.
    const response = await this.request<unknown>('/worlds?page=0&type=world')
    return response.data
  }

  async createWorld(input: CreateVoyageWorldInput): Promise<unknown> {
    if (!input.title.trim()) throw new Error('El título del mundo es obligatorio.')
    if (!isRecord(input.initialGameState)) throw new Error('El initialGameState debe ser un objeto JSON.')
    if (input.tags && (input.tags.length > 10 || input.tags.some((tag) => typeof tag !== 'string' || tag.length > 25))) {
      throw new Error('Voyage permite hasta 10 etiquetas de un máximo de 25 caracteres.')
    }
    const world: CreateVoyageWorldInput = {
      ...input,
      title: input.title.trim(),
      visibility: input.visibility || 'private'
    }
    const response = await this.request<unknown>('/worlds', {
      method: 'POST',
      body: { world },
      idempotencyKey: randomUUID()
    })
    return response.data
  }

  async duplicateWorld(shortId: string): Promise<unknown> {
    if (!shortId.trim() || shortId.length > 256) throw new Error('El identificador del mundo no es válido.')
    const response = await this.request<unknown>(
      `/worlds/${encodeURIComponent(shortId.trim())}/duplicate`,
      { method: 'POST', idempotencyKey: randomUUID() }
    )
    return response.data
  }


  async reorderWorldObjectKeys(
    shortId: string,
    path: string[],
    keys: string[]
  ): Promise<{ reordered: true; world: EditableWorld | null; etag: string | null; refreshError?: string }> {
    if (!shortId.trim() || shortId.length > 256) throw new Error('El identificador del mundo no es válido.')
    if (!Array.isArray(path) || path.length < 1 || path.length > 100 || path.some((segment) => typeof segment !== 'string')) {
      throw new Error('La ruta debe ser un array JSON de entre 1 y 100 segmentos de texto.')
    }
    if (!Array.isArray(keys) || keys.some((key) => typeof key !== 'string') || new Set(keys).size !== keys.length) {
      throw new Error('La lista de claves debe contener textos únicos.')
    }

    // Read the live head immediately before the mutation to obtain a fresh ETag.
    const current = await this.readWorld(shortId)
    if (!current.etag) throw new Error('Voyage no devolvió un ETag actual. No se intentó reordenar el objeto.')

    let target: unknown = current.world.initialGameState
    for (const segment of path) {
      if (!isRecord(target) || !Object.prototype.hasOwnProperty.call(target, segment)) {
        throw new Error('La ruta indicada no existe o atraviesa un valor que no es un objeto.')
      }
      target = target[segment]
    }
    if (!isRecord(target)) throw new Error('La ruta debe apuntar a un objeto JSON; los arrays y valores escalares no se pueden reordenar.')
    const existingKeys = Object.keys(target)
    if (keys.some((key) => !Object.prototype.hasOwnProperty.call(target, key))) {
      throw new Error('La lista contiene claves que no existen en el objeto seleccionado.')
    }
    const integerKeys = keys.filter((key) => /^(0|[1-9]\d*)$/.test(key) && Number(key) <= 4294967294).map(Number)
    if (integerKeys.some((key, index) => index > 0 && key < integerKeys[index - 1])) {
      throw new Error('Las claves que son índices enteros deben conservar el orden numérico ascendente.')
    }
    if (existingKeys.length === 0) throw new Error('El objeto seleccionado está vacío y no tiene claves que reordenar.')

    await this.request<unknown>(`/worlds/${encodeURIComponent(shortId.trim())}/order`, {
      method: 'PATCH',
      ifMatch: current.etag,
      body: { path, keys }
    })

    try {
      const refreshed = await this.readWorld(shortId)
      return { reordered: true, world: refreshed.world, etag: refreshed.etag }
    } catch (error) {
      return {
        reordered: true,
        world: null,
        etag: null,
        refreshError: error instanceof Error ? error.message : 'No se pudo volver a leer el mundo después del reordenamiento.'
      }
    }
  }

  async testConnection(): Promise<VoyageConnectionResult> {
    await this.listWorlds()
    return {
      success: true,
      message: 'Conexión autenticada con Voyage Creator API correcta.'
    }
  }

  async readWorld(shortId: string): Promise<ReadWorldResult> {
    if (!shortId.trim() || shortId.length > 256) {
      throw new Error('El identificador del mundo no es válido.')
    }

    const response = await this.request<unknown>(
      `/worlds/${encodeURIComponent(shortId.trim())}`
    )

    const envelope = isRecord(response.data) ? response.data : null
    const data = envelope && isRecord(envelope.data) ? envelope.data : null
    const candidate = data && isRecord(data.world) ? data.world : null

    if (
      !candidate ||
      typeof candidate.shortId !== 'string' ||
      typeof candidate.title !== 'string' ||
      !isRecord(candidate.initialGameState)
    ) {
      throw new Error(
        'Voyage respondió correctamente, pero el documento no coincide con el formato data.world esperado por la guía oficial. No se modificó ningún dato.'
      )
    }

    return {
      world: candidate as unknown as EditableWorld,
      etag: response.headers.get('ETag')
    }
  }

  async replaceWorld(
    shortId: string,
    world: EditableWorld,
    etag: string
  ): Promise<{ saved: true; world: EditableWorld | null; etag: string | null; refreshError?: string }> {
    if (!shortId.trim() || shortId.length > 256) throw new Error('El identificador del mundo no es válido.')
    if (!etag.trim()) throw new Error('No hay ETag para proteger el guardado. Vuelve a descargar el mundo.')
    if (world.shortId !== shortId) throw new Error('El documento no coincide con el mundo seleccionado.')
    if (!isRecord(world.initialGameState)) throw new Error('El GameState no tiene un formato válido.')

    const response = await this.request<unknown>(`/worlds/${encodeURIComponent(shortId.trim())}`, {
      method: 'PUT',
      ifMatch: etag,
      body: { world }
    })

    // The OpenAPI contract does not guarantee an ETag on PUT, so read the saved draft again.
    try {
      const refreshed = await this.readWorld(shortId)
      return { saved: true, world: refreshed.world, etag: refreshed.etag || response.headers.get('ETag') }
    } catch (error) {
      return {
        saved: true,
        world: null,
        etag: response.headers.get('ETag'),
        refreshError: error instanceof Error ? error.message : 'No se pudo verificar la lectura posterior al guardado.'
      }
    }
  }

  async listWorldRevisions(shortId: string): Promise<import('./types').VoyageRevisionSummary[]> {
    if (!shortId.trim() || shortId.length > 256) throw new Error('El identificador del mundo no es válido.')
    const response = await this.request<unknown>(`/worlds/${encodeURIComponent(shortId.trim())}/revisions`)
    const envelope = isRecord(response.data) ? response.data : null
    const data = envelope && Object.prototype.hasOwnProperty.call(envelope, 'data') ? envelope.data : response.data
    const candidates = Array.isArray(data) ? data : isRecord(data) && Array.isArray(data.revisions) ? data.revisions : null
    if (!candidates) throw new Error('Voyage devolvió el historial con un formato inesperado. No se interpretó ni modificó ningún dato.')
    return candidates.flatMap((item) =>
      isRecord(item) && typeof item.id === 'string' && typeof item.createdAt === 'string'
        ? [{ id: item.id, createdAt: item.createdAt }]
        : []
    )
  }

  async readWorldRevision(shortId: string, revisionId: string): Promise<import('./types').VoyageRevisionDownload> {
    if (!shortId.trim() || shortId.length > 256) throw new Error('El identificador del mundo no es válido.')
    if (!revisionId.trim() || revisionId.length > 256) throw new Error('El identificador de revisión no es válido.')
    const response = await this.request<unknown>(
      `/worlds/${encodeURIComponent(shortId.trim())}/revisions/${encodeURIComponent(revisionId.trim())}`
    )
    const envelope = isRecord(response.data) ? response.data : null
    const data = envelope && isRecord(envelope.data) ? envelope.data : response.data
    const candidate = isRecord(data) && isRecord(data.world)
      ? data.world
      : isRecord(data) && isRecord(data.revision)
        ? data.revision
        : data
    if (!isRecord(candidate) || candidate.shortId !== shortId || !isRecord(candidate.initialGameState)) {
      throw new Error('La revisión descargada no contiene shortId e initialGameState válidos. No se modificó el borrador.')
    }
    return { shortId, initialGameState: candidate.initialGameState }
  }

  async restoreWorldRevision(
    shortId: string,
    revisionId: string
  ): Promise<{ restored: true; world: EditableWorld | null; etag: string | null; refreshError?: string }> {
    if (!shortId.trim() || shortId.length > 256) throw new Error('El identificador del mundo no es válido.')
    if (!revisionId.trim() || revisionId.length > 256) throw new Error('El identificador de revisión no es válido.')

    // Restore must use a fresh ETag from the live head, not the ETag from when the world was opened.
    const current = await this.readWorld(shortId)
    if (!current.etag) throw new Error('Voyage no devolvió un ETag actual. No se intentó restaurar la revisión.')

    const response = await this.request<unknown>(
      `/worlds/${encodeURIComponent(shortId.trim())}/revisions/${encodeURIComponent(revisionId.trim())}/restore`,
      {
        method: 'POST',
        ifMatch: current.etag,
        idempotencyKey: randomUUID()
      }
    )

    // A successful restore creates a new live head. Re-read it before exposing the new state to the UI.
    try {
      const refreshed = await this.readWorld(shortId)
      return {
        restored: true,
        world: refreshed.world,
        etag: refreshed.etag || response.headers.get('ETag')
      }
    } catch (error) {
      return {
        restored: true,
        world: null,
        etag: response.headers.get('ETag'),
        refreshError: error instanceof Error ? error.message : 'No se pudo volver a leer el mundo después de la restauración.'
      }
    }
  }

  async validateDraft(
    initialGameState: Record<string, unknown>
  ): Promise<VoyageValidationResult> {
    const response = await this.request<unknown>('/validate', {
      method: 'POST',
      body: {
        stage: 'draft',
        world: { initialGameState }
      }
    })

    const envelope = isRecord(response.data) ? response.data : null
    const data = envelope && isRecord(envelope.data) ? envelope.data : null
    const requestId = envelope && typeof envelope.requestId === 'string' ? envelope.requestId : null
    if (
      !data ||
      typeof data.valid !== 'boolean' ||
      data.stage !== 'draft' ||
      !Array.isArray(data.errors) ||
      !Array.isArray(data.warnings) ||
      !requestId
    ) {
      throw new Error('Voyage devolvió una respuesta de validación con un formato inesperado.')
    }

    const parseIssues = (items: unknown[]): VoyageValidationIssue[] =>
      items.flatMap((item) =>
        isRecord(item) &&
        typeof item.code === 'string' &&
        typeof item.message === 'string' &&
        typeof item.path === 'string'
          ? [{ code: item.code, message: item.message, path: item.path }]
          : []
      )

    return {
      stage: 'draft',
      valid: data.valid,
      errors: parseIssues(data.errors),
      warnings: parseIssues(data.warnings),
      requestId
    }
  }
}
