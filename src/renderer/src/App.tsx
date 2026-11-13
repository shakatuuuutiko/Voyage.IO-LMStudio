import { useEffect, useRef, useState } from 'react'

interface VoyageWorldSummary {
  shortId: string
  title: string
  description?: string | null
  advancedDescription?: string | null
  image?: string | null
  updatedAt?: string
  createdAt?: string
  visibility?: string
  published?: boolean
  publishedAt?: string | null
  mods?: Array<{ shortId: string; version: number }>
  tags?: string[]
  contentRating?: string
  isLocked?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseWorldList(value: unknown): { worlds: VoyageWorldSummary[]; totalCount: number } {
  if (!isRecord(value) || !isRecord(value.data) || !Array.isArray(value.data.worlds)) {
    throw new Error('La respuesta de Voyage no coincide con el formato data.worlds. Se conserva la respuesta sin interpretarla.')
  }

  const worlds = value.data.worlds.filter((item): item is VoyageWorldSummary =>
    isRecord(item) && typeof item.shortId === 'string' && typeof item.title === 'string'
  )
  const totalCount = typeof value.data.totalCount === 'number' ? value.data.totalCount : worlds.length
  return { worlds, totalCount }
}

interface ProposalChange {
  key: string
  value: unknown
  reason: string
}

function formatDate(value?: string): string {
  if (!value) return 'No disponible'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function App(): React.JSX.Element {
  const [models, setModels] = useState<string[]>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [connection, setConnection] = useState<'loading' | 'connected' | 'disconnected'>('loading')
  const [prompt, setPrompt] = useState('')
  const [response, setResponse] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [maxTokens, setMaxTokens] = useState(4096)
  const [voyageConfigured, setVoyageConfigured] = useState(false)
  const [voyageEncryptionAvailable, setVoyageEncryptionAvailable] = useState(false)
  const [voyageBusy, setVoyageBusy] = useState(false)
  const [voyageNotice, setVoyageNotice] = useState('')
  const [worldListBusy, setWorldListBusy] = useState(false)
  const [worldListOutput, setWorldListOutput] = useState('')
  const [voyageWorlds, setVoyageWorlds] = useState<VoyageWorldSummary[]>([])
  const [worldTotalCount, setWorldTotalCount] = useState(0)
  const [selectedWorldId, setSelectedWorldId] = useState('')
  const [selectedWorldTitle, setSelectedWorldTitle] = useState('')
  const [selectedWorldEtag, setSelectedWorldEtag] = useState<string | null>(null)
  const [selectedWorldJson, setSelectedWorldJson] = useState('')
  const [selectedWorldInitialGameState, setSelectedWorldInitialGameState] = useState<Record<string, unknown> | null>(null)
  const [selectedWorldDraft, setSelectedWorldDraft] = useState<Record<string, unknown> | null>(null)
  const [proposalSectionKey, setProposalSectionKey] = useState('')
  const [proposalRequest, setProposalRequest] = useState('')
  const [proposalBusy, setProposalBusy] = useState(false)
  const [proposalError, setProposalError] = useState('')
  const [proposalChanges, setProposalChanges] = useState<ProposalChange[]>([])
  const [worldReadBusy, setWorldReadBusy] = useState(false)
  const [worldValidationBusy, setWorldValidationBusy] = useState(false)
  const [worldValidation, setWorldValidation] = useState<{ valid: boolean; errors: Array<{ code: string; message: string; path: string }>; warnings: Array<{ code: string; message: string; path: string }>; requestId: string } | null>(null)
  const [worldValidationError, setWorldValidationError] = useState('')
  const apiKeyInput = useRef<HTMLInputElement>(null)

  async function loadModels(): Promise<void> {
    setConnection('loading')
    setNotice('')

    try {
      const result = await window.api.lmStudio.listModels()

      if (!result.success) {
        setConnection('disconnected')
        setNotice(result.error || 'No se pudo conectar con LM Studio.')
        setModels([])
        return
      }

      setModels(result.models)
      setConnection('connected')

      if (result.models.length === 0) {
        setNotice('LM Studio responde, pero no hay modelos disponibles.')
      } else {
        setSelectedModel((current) =>
          current && result.models.includes(current) ? current : result.models[0]
        )
      }
    } catch (error) {
      setConnection('disconnected')
      setNotice(error instanceof Error ? error.message : 'Error de conexión.')
    }
  }

  async function loadVoyageStatus(): Promise<void> {
    try {
      const result = await window.api.voyage.getStatus()
      setVoyageConfigured(result.configured)
      setVoyageEncryptionAvailable(result.encryptionAvailable)
      if (!result.success && result.error) setVoyageNotice(result.error)
    } catch (error) {
      setVoyageNotice(error instanceof Error ? error.message : 'No se pudo consultar Voyage.')
    }
  }

  useEffect(() => {
    void loadModels()
    void loadVoyageStatus()
  }, [])

  async function saveVoyageKey(): Promise<void> {
    const value = apiKeyInput.current?.value.trim()
    if (!value || voyageBusy) {
      setVoyageNotice('Introduce tu Player API Key de Voyage.')
      return
    }

    setVoyageBusy(true)
    setVoyageNotice('')
    try {
      const result = await window.api.voyage.saveApiKey(value)
      if (result.success) {
        if (apiKeyInput.current) apiKeyInput.current.value = ''
        setVoyageConfigured(true)
        setVoyageNotice(result.message || 'API Key guardada.')
      } else {
        setVoyageNotice(result.error || 'No se pudo guardar la API Key.')
      }
    } catch (error) {
      setVoyageNotice(error instanceof Error ? error.message : 'Error al guardar la API Key.')
    } finally {
      setVoyageBusy(false)
    }
  }

  async function testVoyageConnection(): Promise<void> {
    if (voyageBusy) return
    setVoyageBusy(true)
    setVoyageNotice('Comprobando autenticación con Voyage...')
    try {
      const result = await window.api.voyage.testConnection()
      setVoyageNotice(result.success ? (result.message || 'Conexión correcta.') : (result.error || 'Falló la conexión.'))
    } catch (error) {
      setVoyageNotice(error instanceof Error ? error.message : 'Error de conexión.')
    } finally {
      setVoyageBusy(false)
    }
  }

  async function loadVoyageWorlds(): Promise<void> {
    if (worldListBusy) return
    setWorldListBusy(true)
    setWorldListOutput('')
    try {
      const result = await window.api.voyage.listWorlds()
      if (!result.success) throw new Error(result.error || 'No se pudo obtener la lista de mundos.')
      const parsed = parseWorldList(result.worlds)
      setVoyageWorlds(parsed.worlds)
      setWorldTotalCount(parsed.totalCount)
      setSelectedWorldId('')
      setSelectedWorldTitle('')
      setSelectedWorldEtag(null)
      setSelectedWorldJson('')
      setSelectedWorldInitialGameState(null)
      setSelectedWorldDraft(null)
      setProposalSectionKey('')
      setProposalChanges([])
      setProposalError('')
      setWorldValidation(null)
      setWorldValidationError('')
      setWorldListOutput('')
    } catch (error) {
      setWorldListOutput(error instanceof Error ? error.message : 'Error al consultar los mundos.')
    } finally {
      setWorldListBusy(false)
    }
  }

  async function openVoyageWorld(world: VoyageWorldSummary): Promise<void> {
    if (worldReadBusy) return
    setWorldReadBusy(true)
    setSelectedWorldId(world.shortId)
    setSelectedWorldTitle(world.title)
    setSelectedWorldEtag(null)
    setSelectedWorldJson('')
    setSelectedWorldInitialGameState(null)
    setSelectedWorldDraft(null)
    setProposalSectionKey('')
    setProposalChanges([])
    setProposalError('')
    setWorldValidation(null)
    setWorldValidationError('')
    try {
      const result = await window.api.voyage.readWorld(world.shortId)
      if (!result.success || !result.world) {
        throw new Error(result.error || 'No se pudo descargar el documento del mundo.')
      }
      setSelectedWorldEtag(result.etag ?? null)
      setSelectedWorldInitialGameState(result.world.initialGameState)
      setSelectedWorldDraft(JSON.parse(JSON.stringify(result.world.initialGameState)) as Record<string, unknown>)
      setProposalSectionKey('')
      setProposalChanges([])
      setProposalError('')
      setWorldValidation(null)
      setWorldValidationError('')
      setSelectedWorldJson(JSON.stringify(result.world, null, 2))
    } catch (error) {
      setSelectedWorldInitialGameState(null)
      setSelectedWorldDraft(null)
      setSelectedWorldJson(error instanceof Error ? error.message : 'Error al leer el mundo.')
    } finally {
      setWorldReadBusy(false)
    }
  }

  async function validateSelectedWorld(): Promise<void> {
    if (!selectedWorldInitialGameState || worldValidationBusy) return
    setWorldValidationBusy(true)
    setWorldValidation(null)
    setWorldValidationError('')
    try {
      const result = await window.api.voyage.validateDraft(selectedWorldDraft || selectedWorldInitialGameState)
      if (!result.success || !result.validation) throw new Error(result.error || 'Voyage no devolvió el resultado de validación.')
      setWorldValidation(result.validation)
    } catch (error) {
      setWorldValidationError(error instanceof Error ? error.message : 'Error al validar el borrador.')
    } finally {
      setWorldValidationBusy(false)
    }
  }

  async function generateWorldProposal(): Promise<void> {
    if (!selectedWorldDraft || !proposalSectionKey || !proposalRequest.trim() || !selectedModel || proposalBusy) return
    const section = selectedWorldDraft[proposalSectionKey]
    if (!isRecord(section)) {
      setProposalError('La sección seleccionada ya no es un objeto editable.')
      return
    }

    setProposalBusy(true)
    setProposalError('')
    setProposalChanges([])
    try {
      const instruction = [
        'Eres un asistente que propone cambios para un mundo de Voyage Creator Studio.',
        'Devuelve exclusivamente un objeto JSON válido, sin Markdown ni bloques de código.',
        'Formato exacto: {"changes":[{"key":"nombreDePropiedad","value":<valor JSON>,"reason":"motivo breve"}]}.',
        'Solo puedes modificar propiedades directas del objeto de sección proporcionado. No devuelvas rutas, operaciones, código ni propiedades fuera de esa sección.',
        'No incluyas la clave "__proto__", "prototype" ni "constructor". No inventes propiedades de estructura del mundo si no son necesarias.',
        'Máximo 20 cambios. Si no hay cambios necesarios, devuelve {"changes":[]}.',
        '',
        'SECCIÓN:',
        proposalSectionKey,
        'CONTENIDO ACTUAL:',
        JSON.stringify(section),
        '',
        'CAMBIOS SOLICITADOS:',
        proposalRequest.trim()
      ].join('\n')

      const result = await window.api.lmStudio.chat({
        model: selectedModel,
        prompt: instruction,
        maxTokens
      })
      if (!result.success || !result.content) {
        throw new Error(result.error || 'El modelo no devolvió una propuesta.')
      }

      const raw = result.content.trim().replace(/^\x60{3}(?:json)?\s*/i, '').replace(/\s*\x60{3}$/i, '')
      const parsed: unknown = JSON.parse(raw)
      if (!isRecord(parsed) || !Array.isArray(parsed.changes) || parsed.changes.length > 20) {
        throw new Error('La respuesta no respeta el formato de propuesta esperado (changes, máximo 20).')
      }

      const changes = parsed.changes.map((item, index): ProposalChange => {
        if (
          !isRecord(item) ||
          typeof item.key !== 'string' ||
          !item.key.trim() ||
          ['__proto__', 'prototype', 'constructor'].includes(item.key) ||
          typeof item.reason !== 'string' ||
          !Object.prototype.hasOwnProperty.call(item, 'value')
        ) {
          throw new Error(`El cambio ${index + 1} tiene una estructura no permitida.`)
        }
        return { key: item.key, value: item.value, reason: item.reason }
      })
      if (new Set(changes.map((change) => change.key)).size !== changes.length) {
        throw new Error('La propuesta repite propiedades. Solicita una nueva propuesta sin claves duplicadas.')
      }
      setProposalChanges(changes)
      if (changes.length === 0) setProposalError('El modelo no propuso cambios para esta solicitud.')
    } catch (error) {
      setProposalError(error instanceof Error ? error.message : 'No se pudo generar la propuesta.')
    } finally {
      setProposalBusy(false)
    }
  }

  function applyProposalToDraft(): void {
    if (!selectedWorldDraft || !proposalSectionKey || proposalChanges.length === 0) return
    const section = selectedWorldDraft[proposalSectionKey]
    if (!isRecord(section)) {
      setProposalError('La sección seleccionada no es un objeto; no se aplicó ningún cambio.')
      return
    }
    const nextSection: Record<string, unknown> = { ...section }
    for (const change of proposalChanges) nextSection[change.key] = change.value
    setSelectedWorldDraft({ ...selectedWorldDraft, [proposalSectionKey]: nextSection })
    setProposalChanges([])
    setWorldValidation(null)
    setWorldValidationError('')
    setProposalError('Propuesta aplicada únicamente al borrador local en memoria. El mundo remoto no fue modificado.')
  }

  function discardDraftChanges(): void {
    if (!selectedWorldInitialGameState) return
    setSelectedWorldDraft(JSON.parse(JSON.stringify(selectedWorldInitialGameState)) as Record<string, unknown>)
    setProposalChanges([])
    setProposalError('Borrador local restaurado desde la copia original descargada.')
    setWorldValidation(null)
    setWorldValidationError('')
  }

  async function clearVoyageKey(): Promise<void> {
    if (voyageBusy) return
    setVoyageBusy(true)
    try {
      const result = await window.api.voyage.clearApiKey()
      if (result.success) {
        setVoyageConfigured(false)
        setVoyageNotice('API Key eliminada del almacenamiento local.')
      } else {
        setVoyageNotice(result.error || 'No se pudo eliminar la API Key.')
      }
    } catch (error) {
      setVoyageNotice(error instanceof Error ? error.message : 'Error al eliminar la API Key.')
    } finally {
      setVoyageBusy(false)
    }
  }

  async function sendPrompt(): Promise<void> {
    if (!prompt.trim() || !selectedModel || busy) return

    setBusy(true)
    setResponse('')
    setNotice('El modelo está procesando la instrucción...')

    try {
      const result = await window.api.lmStudio.chat({
        model: selectedModel,
        prompt: prompt.trim(),
        maxTokens
      })

      if (!result.success) {
        setNotice(result.error || 'Error al generar la respuesta.')
      } else if (!result.content) {
        setNotice(
          result.reasoningDetected
            ? `El modelo produjo razonamiento interno, pero no una respuesta final. Motivo de finalización: ${result.finishReason || 'no indicado'}. Prueba con un presupuesto de tokens mayor o con otro modelo.`
            : `El modelo no devolvió contenido. Motivo: ${result.finishReason || 'no indicado'}.`
        )
      } else {
        setResponse(result.content)
        setNotice(
          result.finishReason === 'length'
            ? 'Respuesta recibida, pero el modelo alcanzó el límite de tokens.'
            : 'Respuesta recibida correctamente.'
        )
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Error inesperado.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">V</div>
          <div>
            <h1>Voyage AI Companion</h1>
            <p>Asistente local para Voyage Creator Studio</p>
          </div>
        </div>

        <div className={`connection ${connection}`}>
          <span className="status-dot" />
          {connection === 'loading'
            ? 'Comprobando conexión'
            : connection === 'connected'
              ? 'LM Studio conectado'
              : 'LM Studio desconectado'}
        </div>
      </header>

      <section className="workspace">
        <aside className="sidebar">
          <div className="section-label">MOTOR DE IA</div>

          <div className="panel">
            <label htmlFor="model">Modelo local</label>
            <select
              id="model"
              value={selectedModel}
              onChange={(event) => setSelectedModel(event.target.value)}
              disabled={models.length === 0 || busy}
            >
              {models.length === 0 && <option value="">Sin modelos disponibles</option>}
              {models.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>

            <button className="secondary-button" onClick={() => void loadModels()} disabled={busy}>
              Actualizar modelos
            </button>
          </div>

          <div className="section-label">GENERACIÓN</div>
          <div className="panel">
            <label htmlFor="tokens">Presupuesto máximo de tokens</label>
            <select
              id="tokens"
              value={maxTokens}
              onChange={(event) => setMaxTokens(Number(event.target.value))}
              disabled={busy}
            >
              <option value={2048}>2.048</option>
              <option value={4096}>4.096</option>
              <option value={6144}>6.144</option>
              <option value={8192}>8.192</option>
            </select>
            <p className="helper">
              Un límite mayor puede ayudar a modelos que utilizan razonamiento interno.
            </p>
          </div>

          <div className="section-label">INTEGRACIONES</div>
          <div className="integration-item active">
            <span className="integration-indicator" />
            LM Studio
            <span className="integration-tag">LOCAL</span>
          </div>
          <div className={`integration-item ${voyageConfigured ? 'active' : 'pending'}`}>
            <span className="integration-indicator" />
            Voyage Creator API
            <span className="integration-tag">{voyageConfigured ? 'CLAVE GUARDADA' : 'SIN CONFIGURAR'}</span>
          </div>

          <div className="section-label">CUENTA VOYAGE</div>
          <div className="panel">
            <label htmlFor="voyage-api-key">Player API Key</label>
            <input
              ref={apiKeyInput}
              id="voyage-api-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="sk-voyage-v1-..."
              disabled={voyageBusy || !voyageEncryptionAvailable}
            />
            <p className="helper">
              Créala dentro de un mundo en Creator Studio: Settings → API keys → Generate. Copia la clave inmediatamente; Voyage solo la muestra una vez. Se cifra localmente al guardarla mediante el almacenamiento seguro del sistema operativo.
            </p>
            {!voyageEncryptionAvailable && (
              <p className="helper security-warning">
                El cifrado seguro no está disponible. No se puede guardar la clave en este momento.
              </p>
            )}
            <button
              className="secondary-button"
              onClick={() => void saveVoyageKey()}
              disabled={voyageBusy || !voyageEncryptionAvailable}
            >
              Guardar API Key
            </button>
            <button
              className="secondary-button"
              onClick={() => void testVoyageConnection()}
              disabled={voyageBusy || !voyageConfigured}
            >
              Probar conexión
            </button>
            <button
              className="secondary-button"
              onClick={() => void clearVoyageKey()}
              disabled={voyageBusy || !voyageConfigured}
            >
              Eliminar API Key
            </button>
            {voyageNotice && <p className="helper" role="status">{voyageNotice}</p>}
            <button className="secondary-button" onClick={() => void loadVoyageWorlds()} disabled={worldListBusy || !voyageConfigured}>
              {worldListBusy ? 'Consultando mundos...' : 'Consultar mis mundos'}
            </button>
            {worldListOutput && <div className="world-list-inspector">
              <div className="helper">RESULTADO DE LA CONSULTA</div>
              <pre>{worldListOutput}</pre>
            </div>}
            {voyageWorlds.length > 0 && (
              <div className="voyage-world-browser">
                <div className="world-browser-heading">
                  <strong>MIS MUNDOS</strong>
                  <span>{voyageWorlds.length} de {worldTotalCount}</span>
                </div>
                {voyageWorlds.map((world) => (
                  <article className={`voyage-world-card ${selectedWorldId === world.shortId ? 'selected' : ''}`} key={world.shortId}>
                    {world.image ? (
                      <img className="voyage-world-cover" src={world.image} alt="" />
                    ) : (
                      <div className="voyage-world-cover world-cover-empty">SIN PORTADA</div>
                    )}
                    <div className="voyage-world-card-content">
                      <strong>{world.title}</strong>
                      <p>{world.description || 'Sin descripción'}</p>
                      <div className="world-meta">
                        <span>{world.visibility || 'Visibilidad desconocida'}</span>
                        <span>{world.published ? 'Publicado' : 'No publicado'}</span>
                        <span>{world.mods?.length ?? 0} mods</span>
                        <span>Actualizado: {formatDate(world.updatedAt)}</span>
                      </div>
                      <button
                        className="secondary-button"
                        onClick={() => void openVoyageWorld(world)}
                        disabled={worldReadBusy}
                      >
                        {worldReadBusy && selectedWorldId === world.shortId ? 'Descargando...' : 'Abrir / leer mundo'}
                      </button>
                    </div>
                  </article>
                ))}
                {selectedWorldId && (
                  <div className="world-detail-panel">
                    <div className="world-browser-heading">
                      <strong>{selectedWorldTitle}</strong>
                      <span>SOLO LECTURA</span>
                    </div>
                    <p className="helper">shortId: {selectedWorldId}</p>
                    <p className="helper">ETag: {selectedWorldEtag || 'Voyage no devolvió ETag'}</p>
                    {worldReadBusy && <p className="helper">Descargando documento completo...</p>}
                    {selectedWorldJson && <pre>{selectedWorldJson}</pre>}
                    {selectedWorldInitialGameState && (
                      <div className="world-validation-panel">
                        {selectedWorldDraft && (
                          <div className="proposal-editor">
                            <div className="world-browser-heading">
                              <strong>PROPUESTAS DE IA LOCAL</strong>
                              <span>BORRADOR EN MEMORIA</span>
                            </div>
                            <p className="helper">Elige una sección del mundo. El modelo solo recibirá esa sección y podrá proponer cambios en sus propiedades directas.</p>
                            <label htmlFor="proposal-section">Sección editable</label>
                            <select
                              id="proposal-section"
                              value={proposalSectionKey}
                              onChange={(event) => {
                                setProposalSectionKey(event.target.value)
                                setProposalChanges([])
                                setProposalError('')
                              }}
                              disabled={proposalBusy || worldReadBusy}
                            >
                              <option value="">Selecciona una sección...</option>
                              {Object.entries(selectedWorldDraft).filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1])).map(([key]) => (
                                <option key={key} value={key}>{key}</option>
                              ))}
                            </select>
                            <label htmlFor="proposal-request">Cambios que quieres solicitar</label>
                            <textarea
                              id="proposal-request"
                              rows={4}
                              value={proposalRequest}
                              onChange={(event) => setProposalRequest(event.target.value)}
                              placeholder="Describe qué quieres cambiar en esta sección..."
                              disabled={proposalBusy}
                            />
                            <button className="secondary-button" onClick={() => void generateWorldProposal()} disabled={proposalBusy || !selectedModel || !proposalSectionKey || !proposalRequest.trim()}>
                              {proposalBusy ? 'Generando propuesta con LM Studio...' : 'Generar propuesta'}
                            </button>
                            {proposalError && <p className="helper" role="status">{proposalError}</p>}
                            {proposalChanges.length > 0 && (
                              <div className="proposal-review">
                                <strong>Revisión de propuesta · {proposalChanges.length} cambios</strong>
                                {proposalChanges.map((change, index) => (
                                  <div className="proposal-change" key={change.key}>
                                    <strong>{change.key}</strong>
                                    <p>{change.reason}</p>
                                    <pre>{JSON.stringify(change.value, null, 2)}</pre>
                                  </div>
                                ))}
                                <button className="secondary-button" onClick={applyProposalToDraft}>Aplicar al borrador local</button>
                                <button className="secondary-button" onClick={() => setProposalChanges([])}>Descartar propuesta</button>
                              </div>
                            )}
                            <button className="secondary-button" onClick={discardDraftChanges} disabled={proposalBusy || worldValidationBusy}>Descartar todos los cambios del borrador</button>
                            <p className="helper">Los cambios todavía no se guardan en Voyage. Al cerrar o cambiar de mundo, el borrador en memoria se pierde.</p>
                          </div>
                        )}
                        <button className="secondary-button" onClick={() => void validateSelectedWorld()} disabled={worldValidationBusy || worldReadBusy || !selectedWorldDraft}>
                          {worldValidationBusy ? 'Validando borrador...' : 'Validar borrador (sin guardar)'}
                        </button>
                        {worldValidationError && <p className="helper security-warning" role="alert">{worldValidationError}</p>}
                        {worldValidation && (
                          <div className="world-validation-results" role="status">
                            <strong>{worldValidation.valid ? 'Validación correcta' : 'Se encontraron errores'}</strong>
                            <p className="helper">Errores: {worldValidation.errors.length} · Advertencias: {worldValidation.warnings.length}</p>
                            <p className="helper">requestId: {worldValidation.requestId}</p>
                            {worldValidation.errors.map((issue, index) => (
                              <div className="validation-issue validation-error" key={index}>
                                <strong>{issue.code}</strong><p>{issue.message}</p><code>{issue.path}</code>
                              </div>
                            ))}
                            {worldValidation.warnings.map((issue, index) => (
                              <div className="validation-issue validation-warning" key={index}>
                                <strong>{issue.code}</strong><p>{issue.message}</p><code>{issue.path}</code>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>

        <section className="chat-area">
          <div className="chat-heading">
            <div>
              <div className="section-label">ESPACIO DE TRABAJO</div>
              <h2>Prueba del motor local</h2>
              <p>Envía instrucciones directamente al modelo seleccionado.</p>
            </div>
            <span className="local-badge">127.0.0.1:1234</span>
          </div>

          <div className="response-area">
            {!response && !busy ? (
              <div className="empty-state">
                <div className="empty-icon">V</div>
                <h3>Motor local preparado</h3>
                <p>
                  Selecciona un modelo, escribe una instrucción y comprueba su respuesta.
                </p>
              </div>
            ) : (
              <div className="response-content">
                {busy && <div className="loading-line">Procesando instrucción...</div>}
                {response && (
                  <>
                    <div className="response-label">RESPUESTA DEL MODELO</div>
                    <div className="response-text">{response}</div>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="composer">
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Escribe una instrucción para tu modelo local..."
              rows={4}
              disabled={busy}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault()
                  void sendPrompt()
                }
              }}
            />
            <div className="composer-footer">
              <span>Ctrl + Enter para enviar</span>
              <button
                className="send-button"
                onClick={() => void sendPrompt()}
                disabled={busy || !prompt.trim() || !selectedModel}
              >
                {busy ? 'Procesando...' : 'Enviar instrucción'}
              </button>
            </div>
          </div>

          <div className="notice" role="status">
            {notice || 'Conectando con el servidor local...'}
          </div>
        </section>
      </section>

      <footer className="footer">
        <span>Voyage AI Companion</span>
        <span>Motor local · Sin uso de la IA interna de Voyage</span>
      </footer>
    </main>
  )
}

export default App