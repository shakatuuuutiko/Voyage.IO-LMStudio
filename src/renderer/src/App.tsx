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

function extractJsonObject(raw: string): string {
  const start = raw.indexOf('{')
  if (start < 0) throw new Error('La respuesta no contiene ningún objeto JSON.')
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return raw.slice(start, index + 1)
    }
  }
  throw new Error('El objeto JSON está incompleto o fue truncado antes de cerrar todas sus llaves.')
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
  path: string[]
  value: unknown
  previousValue: unknown
  existed: boolean
  reason: string
  category: string
  remove: boolean
}

function readPath(root: unknown, path: string[]): { value: unknown; exists: boolean } {
  let current: unknown = root
  for (const segment of path) {
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      const index = Number(segment)
      if (index >= current.length) return { value: undefined, exists: false }
      current = current[index]
    } else if (isRecord(current) && Object.prototype.hasOwnProperty.call(current, segment)) {
      current = current[segment]
    } else return { value: undefined, exists: false }
  }
  return { value: current, exists: true }
}

function removePath(root: Record<string, unknown>, path: string[]): Record<string, unknown> {
  const next = JSON.parse(JSON.stringify(root)) as Record<string, unknown>
  let current: unknown = next
  for (const segment of path.slice(0, -1)) {
    if (Array.isArray(current) && /^\d+$/.test(segment)) current = current[Number(segment)]
    else if (isRecord(current)) current = current[segment]
    else throw new Error('La ruta que se quiere eliminar dejó de existir.')
  }
  const leaf = path[path.length - 1]
  if (Array.isArray(current) && /^\d+$/.test(leaf)) current.splice(Number(leaf), 1)
  else if (isRecord(current)) delete current[leaf]
  else throw new Error('La ubicación que se quiere eliminar no es editable.')
  return next
}

function writePath(root: Record<string, unknown>, path: string[], value: unknown): Record<string, unknown> {
  const next = JSON.parse(JSON.stringify(root)) as Record<string, unknown>
  let current: unknown = next
  for (const segment of path.slice(0, -1)) {
    if (Array.isArray(current) && /^\d+$/.test(segment)) current = current[Number(segment)]
    else if (isRecord(current)) current = current[segment]
    else throw new Error('La ruta de la propuesta dejó de existir en el borrador.')
  }
  const leaf = path[path.length - 1]
  if (Array.isArray(current) && /^\d+$/.test(leaf)) current[Number(leaf)] = value
  else if (isRecord(current)) current[leaf] = value
  else throw new Error('La ubicación de destino no es un objeto o array editable.')
  return next
}

function summarizeForAI(
  value: unknown,
  depth = 0,
  budget: { remaining: number } = { remaining: 45000 }
): unknown {
  if (budget.remaining <= 80) return '[resumen omitido por límite]'
  if (typeof value === 'string') {
    const allowance = Math.max(0, Math.min(160, budget.remaining - 40))
    const result = value.length > allowance ? value.slice(0, allowance) + '… [texto abreviado]' : value
    budget.remaining -= result.length
    return result
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    budget.remaining -= 12
    return value
  }
  if (Array.isArray(value)) {
    const limit = depth < 2 ? 3 : 2
    return value.slice(0, limit).map((item) => summarizeForAI(item, depth + 1, budget))
  }
  if (isRecord(value)) {
    const entries = Object.entries(value)
    const result: Record<string, unknown> = {}
    const keyLimit = depth === 0 ? 100 : depth === 1 ? 30 : 18
    for (const [key, item] of entries.slice(0, keyLimit)) {
      if (budget.remaining <= 100) break
      budget.remaining -= key.length + 4
      result[key] = depth >= 4
        ? (Array.isArray(item) ? '[array abreviado]' : isRecord(item) ? '[objeto abreviado]' : summarizeForAI(item, depth + 1, budget))
        : summarizeForAI(item, depth + 1, budget)
    }
    if (entries.length > Object.keys(result).length && budget.remaining > 60) {
      result.__summary_omitted_keys = entries.length - Object.keys(result).length
      budget.remaining -= 32
    }
    return result
  }
  return String(value)
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
  const [maxTokens, setMaxTokens] = useState('4096')
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
  const [proposalBusy, setProposalBusy] = useState(false)
  const [proposalError, setProposalError] = useState('')
  const [proposalRawResponse, setProposalRawResponse] = useState('')
  const [proposalChanges, setProposalChanges] = useState<ProposalChange[]>([])
  const [proposalSuggestions, setProposalSuggestions] = useState<Array<{ title: string; detail: string; priority: string }>>([])
  const [worldReadBusy, setWorldReadBusy] = useState(false)
  const [worldValidationBusy, setWorldValidationBusy] = useState(false)
  const [worldValidation, setWorldValidation] = useState<{ valid: boolean; errors: Array<{ code: string; message: string; path: string }>; warnings: Array<{ code: string; message: string; path: string }>; requestId: string } | null>(null)
  const [worldValidationError, setWorldValidationError] = useState('')
  const apiKeyInput = useRef<HTMLInputElement>(null)
  const proposalRequestInput = useRef<HTMLTextAreaElement>(null)

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
      setProposalChanges([])
      setProposalSuggestions([])
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
    setProposalChanges([])
    setProposalSuggestions([])
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
      setProposalChanges([])
      setProposalSuggestions([])
      setProposalError('')
      setWorldValidation(null)
      setWorldValidationError('')
      setSelectedWorldJson('')
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

  async function generateWorldProposal(mode: 'request' | 'recommend' | 'repair' = 'request'): Promise<void> {
    if (!selectedWorldDraft || !selectedModel || proposalBusy) return
    const userRequest = proposalRequestInput.current?.value.trim() || ''
    if (mode === 'request' && !userRequest) return
    setProposalBusy(true)
    setProposalError('')
    setProposalRawResponse('')
    setProposalChanges([])
    setProposalSuggestions([])
    try {
      const task = mode === 'recommend'
        ? 'Analiza el mundo y recomienda entre 5 y 8 mejoras concretas y prioritarias: reparaciones, coherencia, contenido, profundidad, sistemas, balance y oportunidades de expansión. No inventes funciones que el esquema no admita.'
        : mode === 'repair'
          ? 'Corrige los errores de validación indicados usando solo rutas y estructuras compatibles con el GameState actual. Si un problema no puede corregirse con el documento disponible, explícalo en una sugerencia y no inventes campos.'
          : 'Implementa la intención del usuario mediante cambios concretos en cualquier sección pertinente. Decide dónde corresponde cada cambio; no estás limitado a una sección. Si la función no puede expresarse con el GameState disponible, explica la limitación en suggestions.'
      const validationContext = worldValidation
        ? JSON.stringify({ errors: worldValidation.errors, warnings: worldValidation.warnings })
        : 'Sin resultados de validación.'
      const sectionKeys = Object.keys(selectedWorldDraft)
      const structuralSummary = summarizeForAI(selectedWorldDraft)
      const selectionPrompt = [
        'Eres un analista de mundos de Voyage Creator Studio.',
        'Elige las secciones raíz más relevantes para esta tarea. Devuelve solo JSON: {"sections":["claveRaiz"],"reason":"motivo breve"}.',
        'Elige entre 1 y 5 claves EXACTAS de la lista disponible. No inventes nombres. No selecciones todo.',
        'Claves disponibles: ' + JSON.stringify(sectionKeys),
        'TAREA: ' + task,
        mode === 'request' ? 'PETICIÓN DEL USUARIO: ' + userRequest : '',
        mode === 'repair' ? 'RESULTADO DE VALIDACIÓN: ' + validationContext : '',
        'RESUMEN ESTRUCTURAL DEL MUNDO: ' + JSON.stringify(structuralSummary)
      ].filter(Boolean).join('\n')
      const selectionResult = await window.api.lmStudio.chat({
        model: selectedModel, prompt: selectionPrompt, maxTokens: Math.min(2048, Number(maxTokens) || 4096), jsonMode: true
      })
      if (!selectionResult.success || !selectionResult.content) throw new Error(selectionResult.error || 'No se pudieron seleccionar las secciones del mundo.')
      let selection: unknown
      try { selection = JSON.parse(selectionResult.content.trim()) }
      catch { selection = JSON.parse(extractJsonObject(selectionResult.content)) }
      if (!isRecord(selection) || !Array.isArray(selection.sections)) throw new Error('El análisis inicial no devolvió una lista válida de secciones.')
      const selectedKeys = [...new Set(selection.sections.filter((key): key is string => typeof key === 'string' && sectionKeys.includes(key)))].slice(0, 5)
      if (selectedKeys.length === 0) throw new Error('La IA no seleccionó ninguna sección válida del mundo. Reintenta o formula una petición más concreta.')
      const sectionBudget = { remaining: 65000 }
      const focusedWorld = Object.fromEntries(selectedKeys.map((key) => [key, summarizeForAI(selectedWorldDraft[key], 0, sectionBudget)]))
      const instruction = [
        'Eres un arquitecto experto en Voyage Creator Studio y en el GameState del mundo proporcionado.',
        'Recibes un resumen estructural de las secciones elegidas, no el documento completo. No propongas cambios sobre datos que no aparecen.',
        'Devuelve exclusivamente JSON válido, sin Markdown.',
        'Formato exacto: {"changes":[{"path":["seccion","propiedad"],"value":"valor","reason":"justificación","category":"mejora|reparación|contenido|coherencia|balance|sistema"},{"path":["seccion","campoObsoleto"],"remove":true,"reason":"...","category":"reparación"}],"suggestions":[{"title":"título","detail":"explicación","priority":"alta|media|baja"}]}.',
        'Los paths deben señalar ubicaciones reales visibles en el resumen. No uses __summary_omitted_keys ni inventes campos. Los arrays muestran solo sus primeros elementos; usa únicamente índices visibles.',
        'El padre de cada ruta debe existir en el GameState original. No inventes propiedades raíz, campos de configuración ni identificadores.',
        'Conserva tipos, estructuras, IDs y convenciones. No conviertas etiquetas descriptivas en IDs. No reemplaces arrays completos salvo necesidad demostrable.',
        'No uses segmentos "__proto__", "prototype" ni "constructor". Máximo 30 cambios y 8 sugerencias. Evita duplicar cambios ya presentes.',
        'Prioriza propuestas pequeñas, coherentes y verificables. Si la información resumida no basta para proponer un cambio seguro, deja changes vacío y explica la limitación en suggestions.',
        '',
        'TAREA:', task,
        mode === 'request' ? 'PETICIÓN DEL USUARIO: ' + userRequest : '',
        mode === 'repair' ? 'RESULTADO DE VALIDACIÓN: ' + validationContext : '',
        'SECCIONES SELECCIONADAS: ' + selectedKeys.join(', '),
        'RESUMEN DE LAS SECCIONES (las rutas corresponden a las claves originales):',
        JSON.stringify(focusedWorld)
      ].filter(Boolean).join('\n')
      const result = await window.api.lmStudio.chat({ model: selectedModel, prompt: instruction, maxTokens: Number(maxTokens) || 4096, jsonMode: true })
      if (!result.success || !result.content) throw new Error(result.error || 'El modelo no devolvió una propuesta.')
      setProposalRawResponse(result.content)
      if (result.finishReason === 'length') throw new Error('LM Studio truncó la respuesta. Aumenta el presupuesto de tokens e inténtalo de nuevo.')
      let parsed: unknown
      try { parsed = JSON.parse(result.content.trim()) }
      catch { parsed = JSON.parse(extractJsonObject(result.content)) }
      if (!isRecord(parsed) || !Array.isArray(parsed.changes) || parsed.changes.length > 30) {
        throw new Error('La respuesta no respeta el formato esperado (changes, máximo 30).')
      }
      const changes = parsed.changes.map((item, index): ProposalChange => {
        if (!isRecord(item) || !Array.isArray(item.path) || item.path.length === 0 ||
          !item.path.every((part) => typeof part === 'string' && part.length > 0) ||
          item.path.some((part) => ['__proto__', 'prototype', 'constructor'].includes(part)) ||
          typeof item.reason !== 'string' || (!Object.prototype.hasOwnProperty.call(item, 'value') && item.remove !== true)) {
          throw new Error(`El cambio ${index + 1} tiene una ruta o estructura no permitida. La respuesta original se muestra abajo.`)
        }
        const path = item.path as string[]
        const parent = readPath(selectedWorldDraft, path.slice(0, -1))
        if (!parent.exists || (!isRecord(parent.value) && !Array.isArray(parent.value))) {
          throw new Error(`La ruta del cambio ${index + 1} apunta a una sección inexistente o no editable: ${path.join('.')}`)
        }
        const current = readPath(selectedWorldDraft, path)
        const leaf = path[path.length - 1]
        if (item.remove === true && !current.exists) {
          throw new Error(`El cambio ${index + 1} intenta eliminar una propiedad que no existe: ${path.join('.')}`)
        }
        if (Array.isArray(parent.value) && (!/^\d+$/.test(leaf) || Number(leaf) > parent.value.length || (item.remove === true && Number(leaf) >= parent.value.length))) {
          throw new Error(`El cambio ${index + 1} contiene un índice de array no permitido: ${path.join('.')}`)
        }
        return { path, value: item.value, previousValue: current.value, existed: current.exists,
          reason: item.reason, category: typeof item.category === 'string' ? item.category : 'modificación', remove: item.remove === true }
      })
      const pathKeys = changes.map((change) => JSON.stringify(change.path))
      if (new Set(pathKeys).size !== pathKeys.length) throw new Error('La propuesta repite rutas.')
      setProposalChanges(changes)
      const suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : []
      setProposalSuggestions(suggestions.filter((item): item is Record<string, unknown> =>
        isRecord(item) && typeof item.title === 'string' && typeof item.detail === 'string'
      ).slice(0, 8).map((item) => ({
        title: String(item.title), detail: String(item.detail),
        priority: typeof item.priority === 'string' ? item.priority : 'media'
      })))
      if (changes.length === 0 && (!Array.isArray(parsed.suggestions) || parsed.suggestions.length === 0)) {
        setProposalError('El modelo no encontró cambios seguros ni recomendaciones.')
      } else if (changes.length === 0) {
        setProposalError('La IA generó recomendaciones, pero no encontró cambios que pueda representar de forma segura en el esquema actual.')
      }
    } catch (error) {
      setProposalError(error instanceof Error ? error.message : 'No se pudo generar la propuesta.')
    } finally {
      setProposalBusy(false)
    }
  }

  function applyProposalToDraft(): void {
    if (!selectedWorldDraft || proposalChanges.length === 0) return
    try {
      let next = selectedWorldDraft
      for (const change of proposalChanges) next = change.remove ? removePath(next, change.path) : writePath(next, change.path, change.value)
      setSelectedWorldDraft(next)
      setProposalChanges([])
      setWorldValidation(null)
      setWorldValidationError('')
      setProposalError('Propuesta aplicada únicamente al borrador local en memoria. El mundo remoto no fue modificado.')
    } catch (error) {
      setProposalError(error instanceof Error ? error.message : 'No se pudo aplicar la propuesta.')
    }
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
        maxTokens: Number(maxTokens) || 4096
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
            <input
              id="tokens"
              type="number"
              min={256}
              max={65536}
              step={256}
              value={maxTokens}
              onChange={(event) => setMaxTokens(event.target.value)}
              disabled={busy || proposalBusy}
            />
            <p className="helper">
              Tokens máximos de salida (256–65.536). También se usan al generar propuestas. La ventana de contexto de entrada se configura por separado en LM Studio.
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
                    {selectedWorldInitialGameState ? (
                      selectedWorldJson ? (
                        <>
                          <button className="secondary-button" onClick={() => setSelectedWorldJson('')}>Ocultar JSON del mundo</button>
                          <pre className="world-json-inspector">{selectedWorldJson}</pre>
                        </>
                      ) : (
                        <button className="secondary-button" onClick={() => setSelectedWorldJson(JSON.stringify(selectedWorldDraft || selectedWorldInitialGameState, null, 2))}>
                          Mostrar GameState completo (solo al solicitarlo)
                        </button>
                      )
                    ) : selectedWorldJson ? <p className="helper">{selectedWorldJson}</p> : null}
                    {selectedWorldInitialGameState && (
                      <div className="world-validation-panel">
                        {selectedWorldDraft && (
                          <div className="proposal-editor">
                            <div className="world-browser-heading">
                              <strong>PROPUESTAS DE IA LOCAL</strong>
                              <span>BORRADOR EN MEMORIA</span>
                            </div>
                            <p className="helper">Describe libremente el resultado que buscas. La IA resumirá la estructura del mundo, seleccionará las secciones relevantes y analizará su contenido para proponer cambios coordinados. También puedes pedir recomendaciones sin escribir una instrucción.</p>
                            <label htmlFor="proposal-request">¿Qué quieres conseguir?</label>
                            <textarea id="proposal-request" ref={proposalRequestInput} rows={4}
                              placeholder="Ej.: Quiero facciones más dinámicas, con territorios, jerarquías, relaciones y evolución..."
                              disabled={proposalBusy} />
                            <button className="secondary-button" onClick={() => void generateWorldProposal('request')} disabled={proposalBusy || !selectedModel}>
                              {proposalBusy ? 'Analizando el mundo con LM Studio...' : 'Proponer cambios'}
                            </button>
                            <button className="secondary-button recommend-button" onClick={() => void generateWorldProposal('recommend')} disabled={proposalBusy || !selectedModel}>
                              {proposalBusy ? 'Analizando...' : 'Recomiéndame'}
                            </button>
                            {worldValidation && worldValidation.errors.length > 0 && (
                              <button className="secondary-button" onClick={() => void generateWorldProposal('repair')} disabled={proposalBusy || !selectedModel}>
                                Proponer correcciones de validación
                              </button>
                            )}
                            {proposalError && <p className="helper" role="status">{proposalError}</p>}
                            {proposalRawResponse && proposalError && (
                              <details className="proposal-raw-response">
                                <summary>Ver respuesta original de LM Studio</summary>
                                <pre>{proposalRawResponse}</pre>
                              </details>
                            )}
                            {proposalSuggestions.length > 0 && (
                              <div className="proposal-review">
                                <strong>Recomendaciones de la IA · {proposalSuggestions.length}</strong>
                                {proposalSuggestions.map((suggestion, index) => (
                                  <div className="proposal-change" key={index}>
                                    <strong>{suggestion.title}</strong>
                                    <span className="helper">Prioridad: {suggestion.priority}</span>
                                    <p>{suggestion.detail}</p>
                                  </div>
                                ))}
                              </div>
                            )}
                            {proposalChanges.length > 0 && (
                              <div className="proposal-review">
                                <strong>Revisión de propuesta · {proposalChanges.length} cambios</strong>
                                {proposalChanges.map((change) => (
                                  <div className="proposal-change" key={JSON.stringify(change.path)}>
                                    <strong>{change.path.join(' › ')}</strong>
                                    <span className="helper">{change.category}</span>
                                    <p>{change.reason}</p>
                                    <span className="helper">Valor actual{change.existed ? '' : ' (propiedad nueva)'}</span>
                                    <pre>{change.existed ? JSON.stringify(change.previousValue, null, 2) : '— No existe actualmente —'}</pre>
                                    <span className="helper">Valor propuesto</span>
                                    <pre>{change.remove ? '— Eliminar esta propiedad —' : JSON.stringify(change.value, null, 2)}</pre>
                                  </div>
                                ))}
                                <button className="secondary-button" onClick={applyProposalToDraft}>Aplicar al borrador local</button>
                                <button className="secondary-button" onClick={() => { setProposalChanges([]); setProposalSuggestions([]) }}>Descartar propuesta</button>
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