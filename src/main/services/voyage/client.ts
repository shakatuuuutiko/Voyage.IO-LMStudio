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

export interface VoyageConnectionResult {
  success: true
  message: string
}

export class VoyageCreatorClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = VOYAGE_API_BASE_URL
  ) {}

  private async request<T>(path: string): Promise<T> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: 'application/json'
        },
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
        const errorPayload = (payload && typeof payload === 'object'
          ? payload
          : {}) as VoyageErrorPayload
        const retryAfter = response.headers.get('Retry-After')
        throw new VoyageApiError(
          errorPayload.error?.message || `Voyage Creator API respondió HTTP ${response.status}.`,
          {
            status: response.status,
            code: errorPayload.error?.code,
            requestId: errorPayload.requestId,
            retryAfterSeconds: retryAfter ? Number(retryAfter) : undefined
          }
        )
      }

      return payload as T
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

  async testConnection(): Promise<VoyageConnectionResult> {
    // The API guide defines page as a zero-based optional query parameter.
    // The response schema for the world list is intentionally not inferred here:
    // a successful authenticated HTTP response is sufficient for a connection test.
    await this.request<unknown>('/worlds?page=0&type=world')
    return {
      success: true,
      message: 'Conexión autenticada con Voyage Creator API correcta.'
    }
  }
}
