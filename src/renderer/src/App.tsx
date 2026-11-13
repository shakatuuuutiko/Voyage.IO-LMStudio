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

function getProposalValueKind(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (isRecord(value)) return 'object'
  return typeof value
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
  const [proposalInfo, setProposalInfo] = useState('')
  const [proposalRawResponse, setProposalRawResponse] = useState('')
  const [proposalChanges, setProposalChanges] = useState<ProposalChange[]>([])
  const [proposalSuggestions, setProposalSuggestions] = useState<Array<{ title: string; detail: string; priority: string }>>([])
  const [worldReadBusy, setWorldReadBusy] = useState(false)
  const [worldValidationBusy, setWorldValidationBusy] = useState(false)
  const [worldValidation, setWorldValidation] = useState<{ valid: boolean; errors: Array<{ code: string; message: string; path: string }>; warnings: Array<{ code: string; message: string; path: string }>; requestId: string } | null>(null)
  const [worldValidationError, setWorldValidationError] = useState('')
  const [worldIndex, setWorldIndex] = useState<{ generatedAt: string; nodeCount: number; complete: boolean; rootKeys: string[] } | null>(null)
  const [indexBusy, setIndexBusy] = useState(false)
  const [indexQuery, setIndexQuery] = useState('')
  const [indexResults, setIndexResults] = useState<Array<{ path: string; key: string; kind: string; preview: string; childCount: number }>>([])
  const [trackedIssues, setTrackedIssues] = useState<Array<{ id: string; source: string; severity: string; code: string; message: string; path: string; status: string; occurrences: number; history: Array<{ at: string; action: string; detail: string }> }>>([])
  const [workspaceNotice, setWorkspaceNotice] = useState('')
  const [issueReport, setIssueReport] = useState('')
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
    setWorldIndex(null)
    setIndexQuery('')
    setIndexResults([])
    setTrackedIssues([])
    setIssueReport('')
    setWorkspaceNotice('')
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
      setIndexBusy(true)
      try {
        const indexResult = await window.api.workspace.buildIndex({ worldId: world.shortId, gameState: result.world.initialGameState })
        if (!indexResult.success || !indexResult.index) throw new Error(indexResult.error || 'No se pudo generar el índice local.')
        setWorldIndex(indexResult.index)
        setWorkspaceNotice('Índice local actualizado desde el GameState descargado.')
      } catch (indexError) {
        setWorldIndex(null)
        setWorkspaceNotice(indexError instanceof Error ? indexError.message : 'Falló la generación del índice.')
      } finally {
        setIndexBusy(false)
      }
      const issuesResult = await window.api.workspace.listIssues(world.shortId)
      setTrackedIssues(issuesResult.success ? issuesResult.issues : [])
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
      const detectedIssues = [
        ...result.validation.errors.map((issue) => ({ ...issue, severity: 'error' as const })),
        ...result.validation.warnings.map((issue) => ({ ...issue, severity: 'warning' as const }))
      ]
      for (const issue of detectedIssues) {
        await window.api.workspace.recordIssue({
          worldId: selectedWorldId, source: 'voyage-validation',
          severity: issue.severity, code: issue.code, message: issue.message, path: issue.path
        })
      }
      const issueResult = await window.api.workspace.listIssues(selectedWorldId)
      if (issueResult.success) {
        const currentKeys = new Set(detectedIssues.map((issue) => [issue.code, issue.path, issue.message].join('|')))
        for (const previous of issueResult.issues) {
          const key = [previous.code, previous.path, previous.message].join('|')
          if (previous.source === 'voyage-validation' &&
            previous.status !== 'resolved' && previous.status !== 'false-positive' &&
            !currentKeys.has(key)) {
            await window.api.workspace.updateIssue({
              worldId: selectedWorldId, issueId: previous.id, status: 'resolved',
              detail: 'No volvió a aparecer en la última validación completa de Voyage.'
            })
          }
        }
        const refreshed = await window.api.workspace.listIssues(selectedWorldId)
        if (refreshed.success) setTrackedIssues(refreshed.issues)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error al validar el borrador.'
      setWorldValidationError(message)
      if (selectedWorldId) {
        await window.api.workspace.recordIssue({
          worldId: selectedWorldId, source: 'application', severity: 'error',
          code: 'VOYAGE_VALIDATION_REQUEST_FAILURE', message, path: ''
        })
        const issueResult = await window.api.workspace.listIssues(selectedWorldId)
        if (issueResult.success) setTrackedIssues(issueResult.issues)
      }
    } finally {
      setWorldValidationBusy(false)
    }
  }

  async function reportManualIssue(): Promise<void> {
    if (!selectedWorldId || !issueReport.trim()) return
    const result = await window.api.workspace.recordIssue({
      worldId: selectedWorldId, source: 'user', severity: 'notice',
      code: 'USER_REPORTED_ISSUE', message: issueReport.trim(), path: ''
    })
    if (!result.success) {
      setWorkspaceNotice(result.error || 'No se pudo registrar el reporte.')
      return
    }
    setIssueReport('')
    const refreshed = await window.api.workspace.listIssues(selectedWorldId)
    if (refreshed.success) setTrackedIssues(refreshed.issues)
    setWorkspaceNotice('Reporte guardado en el registro local.')
  }

  async function searchWorldKnowledge(): Promise<void> {
    if (!selectedWorldId || !indexQuery.trim()) return
    const result = await window.api.workspace.searchIndex({ worldId: selectedWorldId, query: indexQuery.trim(), limit: 80 })
    if (result.success) setIndexResults(result.results)
    else setWorkspaceNotice(result.error || 'No se pudo consultar el índice.')
  }

  async function changeIssueStatus(issueId: string, status: 'investigating' | 'fixed-pending-validation' | 'resolved' | 'false-positive'): Promise<void> {
    const result = await window.api.workspace.updateIssue({ worldId: selectedWorldId, issueId, status, detail: 'Estado actualizado desde la interfaz.' })
    if (result.success && result.issues) setTrackedIssues(result.issues)
    else setWorkspaceNotice(result.error || 'No se pudo actualizar el problema.')
  }

  async function generateWorldProposal(mode: 'request' | 'recommend' | 'repair' = 'request'): Promise<void> {
    if (!selectedWorldDraft || !selectedModel || proposalBusy) return
    const userRequest = proposalRequestInput.current?.value.trim() || ''
    if (mode === 'request' && !userRequest) return
    setProposalBusy(true)
    setProposalError('')
    setProposalInfo('')
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
      const retrievalText = mode === 'repair' ? validationContext : mode === 'recommend' ? 'factions locations NPCs skills resources items quests combat progression settings world lore' : userRequest
      const retrievalTerms = [...new Set((retrievalText.toLocaleLowerCase().match(/[\\p{L}\\p{N}_-]{4,}/gu) || []).slice(0, 10))].join(' ')
      const indexLookup = await window.api.workspace.searchIndex({ worldId: selectedWorldId, query: retrievalTerms, limit: 80 })
      const indexMatches = indexLookup.success ? indexLookup.results.slice(0, 35) : []
      const indexedRootKeys = [...new Set(indexMatches.map((item) => item.path.split('/')[1]?.replace(/~1/g, '/').replace(/~0/g, '~')).filter((key): key is string => Boolean(key) && sectionKeys.includes(key)))]
      const selectionPrompt = [
        'Eres un analista de mundos de Voyage Creator Studio.',
        'Elige las secciones raíz más relevantes para esta tarea. Devuelve solo JSON: {"sections":["claveRaiz"],"reason":"motivo breve"}.',
        'Elige entre 1 y 5 claves EXACTAS de la lista disponible. No inventes nombres. No selecciones todo.',
        'Claves disponibles: ' + JSON.stringify(sectionKeys),
        'TAREA: ' + task,
        'ESTADO DEL ÍNDICE LOCAL: ' + (worldIndex?.complete ? 'completo' : 'parcial o no disponible') + '. El índice es una ayuda de recuperación, no sustituye al GameState.',
        'PISTAS DEL ÍNDICE LOCAL (rutas y fragmentos recuperados por búsqueda; prioriza estas secciones si son pertinentes): ' + JSON.stringify({ indexedRootKeys, matches: indexMatches }),
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
        'Formato exacto: {"changes":[{"path":"/seccion/propiedad","value":"valor","reason":"justificación","category":"mejora|reparación|contenido|coherencia|balance|sistema"}],"suggestions":[{"title":"título","detail":"explicación","priority":"alta|media|baja"}]}.',
        'path es un JSON Pointer en texto, NO un array. Ejemplo: /factions/Helix Dominion/basicInfo. Escapa ~ como ~0 y / como ~1 dentro de cada nombre de clave. Mantén value, reason y category como propiedades hermanas de path.',
        'No generes cambios de eliminación; si un campo debe retirarse, deja changes vacío y explícalo en suggestions.',
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
        'FRAGMENTOS RECUPERADOS DEL ÍNDICE LOCAL: ' + JSON.stringify(indexMatches.filter((item) => selectedKeys.includes(item.path.split('/')[1]?.replace(/~1/g, '/').replace(/~0/g, '~') || '')).slice(0, 25)),
        'RESUMEN DE LAS SECCIONES (las rutas corresponden a las claves originales):',
        JSON.stringify(focusedWorld)
      ].filter(Boolean).join('\n')
      const result = await window.api.lmStudio.chat({ model: selectedModel, prompt: instruction, maxTokens: Number(maxTokens) || 4096, jsonMode: true })
      if (!result.success || !result.content) throw new Error(result.error || 'El modelo no devolvió una propuesta.')
      if (result.finishReason === 'length') {
        setProposalRawResponse(result.content)
        throw new Error('LM Studio truncó la respuesta. Aumenta el presupuesto de tokens e inténtalo de nuevo.')
      }

      // Algunos modelos locales generan JSON casi válido, pero omiten cierres de arrays
      // o mezclan campos del objeto dentro de path. No intentamos reparar eso con regex:
      // pedimos al mismo modelo una normalización y luego validamos las rutas contra el GameState.
      setProposalRawResponse(result.content)
      let proposalContent = result.content
      let parsed: unknown
      try {
        try { parsed = JSON.parse(proposalContent.trim()) }
        catch { parsed = JSON.parse(extractJsonObject(proposalContent)) }
      } catch {
        const repairPrompt = [
          'Actúa exclusivamente como reparador de JSON. La respuesta siguiente contiene una propuesta con sintaxis JSON defectuosa.',
          'Reconstruye el JSON conservando exactamente la intención y los datos que sí aparecen. No añadas cambios, campos, rutas ni recomendaciones nuevas.',
          'Devuelve únicamente un objeto JSON válido, sin Markdown ni explicaciones.',
          'Estructura obligatoria: {"changes":[{"path":"/claveRaiz/propiedad/campo","value":"valor JSON","reason":"texto","category":"mejora|reparación|contenido|coherencia|balance|sistema"}],"suggestions":[{"title":"texto","detail":"texto","priority":"alta|media|baja"}]}.',
          'IMPORTANTE: path siempre es un STRING JSON Pointer, por ejemplo "/resourceSettings/Combat Energy/maxValue". Nunca escribas objetos o propiedades dentro de path. value, reason y category son propiedades hermanas de path. No uses arrays para path.',
          'Si un cambio está demasiado dañado para reconstruirlo sin adivinar, omite ese cambio. Conserva las sugerencias que puedas recuperar.',
          'RESPUESTA ORIGINAL DEFECTUOSA:',
          proposalContent
        ].join('\n')
        const repairResult = await window.api.lmStudio.chat({
          model: selectedModel,
          prompt: repairPrompt,
          maxTokens: Math.max(2048, Math.min(8192, Number(maxTokens) || 4096)),
          jsonMode: true
        })
        if (!repairResult.success || !repairResult.content) {
          setProposalRawResponse(proposalContent)
          throw new Error('La respuesta JSON era inválida y LM Studio no pudo repararla. ' + (repairResult.error || ''))
        }
        if (repairResult.finishReason === 'length') {
          setProposalRawResponse('RESPUESTA ORIGINAL:\\n' + proposalContent + '\\n\\nINTENTO DE REPARACIÓN TRUNCADO:\\n' + repairResult.content)
          throw new Error('El intento de reparación también quedó truncado. Reduce la complejidad de la propuesta o aumenta el presupuesto de salida.')
        }
        proposalContent = repairResult.content
        setProposalRawResponse('RESPUESTA ORIGINAL (JSON INVÁLIDO):\\n' + result.content + '\\n\\nRESPUESTA NORMALIZADA POR LM STUDIO:\\n' + repairResult.content)
        try { parsed = JSON.parse(proposalContent.trim()) }
        catch { parsed = JSON.parse(extractJsonObject(proposalContent)) }
      }
      if (!isRecord(parsed) || !Array.isArray(parsed.changes) || parsed.changes.length > 30) {
        throw new Error('La respuesta no respeta el formato esperado (changes, máximo 30).')
      }
      const changes = parsed.changes.map((item, index): ProposalChange | null => {
        if (!isRecord(item) || typeof item.path !== 'string' || !item.path.startsWith('/') ||
          typeof item.reason !== 'string' || !Object.prototype.hasOwnProperty.call(item, 'value')) {
          throw new Error(`El cambio ${index + 1} tiene una ruta o estructura no permitida. Se esperaba path como JSON Pointer de texto y value como propiedad independiente.`)
        }
        const path = item.path.slice(1).split('/').map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
        if (path.length === 0 || path.some((part) => !part || ['__proto__', 'prototype', 'constructor'].includes(part))) {
          throw new Error(`El cambio ${index + 1} contiene un JSON Pointer vacío o no permitido.`)
        }
        const parent = readPath(selectedWorldDraft, path.slice(0, -1))
        if (!parent.exists || (!isRecord(parent.value) && !Array.isArray(parent.value))) {
          throw new Error(`La ruta del cambio ${index + 1} apunta a una sección inexistente o no editable: ${path.join('.')}`)
        }
        const current = readPath(selectedWorldDraft, path)
        const leaf = path[path.length - 1]
        if (Array.isArray(parent.value) && (!/^\d+$/.test(leaf) || Number(leaf) > parent.value.length)) {
          throw new Error(`El cambio ${index + 1} contiene un índice de array no permitido: ${path.join('.')}`)
        }
        if (current.exists && getProposalValueKind(current.value) !== getProposalValueKind(item.value)) return null
        return { path, value: item.value, previousValue: current.value, existed: current.exists,
          reason: item.reason, category: typeof item.category === 'string' ? item.category : 'modificación', remove: false }
      })
      const typedChanges = changes.filter((change): change is ProposalChange => change !== null)
      const effectiveChanges = typedChanges.filter((change) =>
        !change.existed || JSON.stringify(change.previousValue) !== JSON.stringify(change.value)
      )
      const ignoredTypeChanges = changes.length - typedChanges.length
      const ignoredNoOpChanges = typedChanges.length - effectiveChanges.length
      const pathKeys = effectiveChanges.map((change) => JSON.stringify(change.path))
      if (new Set(pathKeys).size !== pathKeys.length) throw new Error('La propuesta repite rutas.')
      setProposalChanges(effectiveChanges)
      const ignoredMessages = [
        ignoredTypeChanges ? `${ignoredTypeChanges} cambio(s) descartado(s) por incompatibilidad de tipo` : '',
        ignoredNoOpChanges ? `${ignoredNoOpChanges} cambio(s) descartado(s) porque no modificaban el valor` : ''
      ].filter(Boolean)
      setProposalInfo(ignoredMessages.length ? 'Control automático: ' + ignoredMessages.join('; ') + '.' : '')
      const suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : []
      setProposalSuggestions(suggestions.filter((item): item is Record<string, unknown> =>
        isRecord(item) && typeof item.title === 'string' && typeof item.detail === 'string'
      ).slice(0, 8).map((item) => ({
        title: String(item.title), detail: String(item.detail),
        priority: typeof item.priority === 'string' ? item.priority : 'media'
      })))
      if (effectiveChanges.length === 0 && (!Array.isArray(parsed.suggestions) || parsed.suggestions.length === 0)) {
        setProposalError('El modelo no encontró cambios seguros ni recomendaciones.')
      } else if (effectiveChanges.length === 0) {
        setProposalError('La IA generó recomendaciones, pero no encontró cambios que pueda representar de forma segura en el esquema actual.')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo generar la propuesta.'
      setProposalError(message)
      if (selectedWorldId) {
        await window.api.workspace.recordIssue({
          worldId: selectedWorldId, source: 'lm-studio', severity: 'warning',
          code: 'LOCAL_AI_PROPOSAL_FAILURE', message, path: ''
        }).catch(() => undefined)
        const issueResult = await window.api.workspace.listIssues(selectedWorldId)
        if (issueResult.success) setTrackedIssues(issueResult.issues)
      }
    } finally {
      setProposalBusy(false)
    }
  }

  async function applyProposalToDraft(): Promise<void> {
    if (!selectedWorldDraft || proposalChanges.length === 0) return
    try {
      let next = selectedWorldDraft
      for (const change of proposalChanges) next = change.remove ? removePath(next, change.path) : writePath(next, change.path, change.value)
      setSelectedWorldDraft(next)
      const indexResult = await window.api.workspace.buildIndex({ worldId: selectedWorldId, gameState: next })
      if (indexResult.success && indexResult.index) setWorldIndex(indexResult.index)
      setProposalChanges([])
      setWorldValidation(null)
      setWorldValidationError('')
      setProposalError('Propuesta aplicada únicamente al borrador local en memoria. El mundo remoto no fue modificado.')
    } catch (error) {
      setProposalError(error instanceof Error ? error.message : 'No se pudo aplicar la propuesta.')
    }
  }

  async function discardDraftChanges(): Promise<void> {
    if (!selectedWorldInitialGameState) return
    const restored = JSON.parse(JSON.stringify(selectedWorldInitialGameState)) as Record<string, unknown>
    setSelectedWorldDraft(restored)
    if (selectedWorldId) {
      const indexResult = await window.api.workspace.buildIndex({ worldId: selectedWorldId, gameState: restored })
      if (indexResult.success && indexResult.index) setWorldIndex(indexResult.index)
    }
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
                      <section className="world-intelligence-panel">
                        <div className="world-browser-heading">
                          <strong>WORLD KNOWLEDGE INDEX</strong>
                          <span>{indexBusy ? 'GENERANDO...' : worldIndex ? worldIndex.nodeCount.toLocaleString() + (worldIndex.complete ? ' NODOS' : ' NODOS · PARCIAL') : 'SIN ÍNDICE'}</span>
                        </div>
                        <p className="helper">Índice estructural local del GameState. Conserva rutas JSON Pointer exactas y permite localizar contenido sin enviar todo el mundo a LM Studio.</p>
                        {worldIndex && <p className="helper">Actualizado: {formatDate(worldIndex.generatedAt)} · Secciones raíz: {worldIndex.rootKeys.length}</p>}
                        {workspaceNotice && <p className="helper" role="status">{workspaceNotice}</p>}
                        <div className="index-search-row">
                          <input value={indexQuery} onChange={(event) => setIndexQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void searchWorldKnowledge() }} placeholder="Buscar facciones, NPCs, habilidades, términos..." />
                          <button className="secondary-button" onClick={() => void searchWorldKnowledge()}>Buscar</button>
                        </div>
                        {indexResults.length > 0 && <div className="index-results">
                          <strong>Resultados · {indexResults.length}</strong>
                          {indexResults.map((item) => <article className="index-result" key={item.path}>
                            <strong>{item.key}</strong><code>{item.path}</code>
                            <span>{item.kind} · {item.childCount} elementos</span><p>{item.preview}</p>
                          </article>)}
                        </div>}
                        <div className="world-browser-heading issue-heading">
                          <strong>REGISTRO DE PROBLEMAS Y REPARACIONES</strong>
                          <span>{trackedIssues.filter((issue) => issue.status !== 'resolved' && issue.status !== 'false-positive').length} ABIERTOS</span>
                        </div>
                        <p className="helper">Los errores y warnings de validación se guardan localmente. También puedes registrar fallos fantasma o advertencias observadas durante una partida. Las reparaciones conservan historial; un problema que reaparece se vuelve a abrir.</p>
                        <div className="manual-issue-report">
                          <textarea rows={2} value={issueReport} onChange={(event) => setIssueReport(event.target.value)} placeholder="Describe un fallo observado, warning o comportamiento extraño..." />
                          <button className="secondary-button" onClick={() => void reportManualIssue()} disabled={!issueReport.trim()}>Registrar problema observado</button>
                        </div>
                        {trackedIssues.length === 0 ? <p className="helper">Todavía no hay problemas registrados. Ejecuta una validación para iniciar el seguimiento.</p> :
                          trackedIssues.slice(0, 30).map((issue) => <article className="tracked-issue" key={issue.id}>
                            <div className="world-browser-heading"><strong>{issue.code}</strong><span>{issue.severity.toUpperCase()} · {issue.status}</span></div>
                            <p>{issue.message}</p><code>{issue.path || 'Sin ruta'}</code>
                            <span className="helper">Detectado {issue.occurrences} vez/veces</span>
                            {issue.history.length > 0 && <details className="issue-history">
                              <summary>Historial · {issue.history.length} eventos</summary>
                              {issue.history.slice(-10).reverse().map((entry, index) => <div className="issue-history-entry" key={index}>
                                <span>{formatDate(entry.at)} · {entry.action}</span><p>{entry.detail}</p>
                              </div>)}
                            </details>}
                            <div className="issue-actions">
                              {issue.status !== 'investigating' && <button className="secondary-button" onClick={() => void changeIssueStatus(issue.id, 'investigating')}>Investigar</button>}
                              {issue.status !== 'fixed-pending-validation' && <button className="secondary-button" onClick={() => void changeIssueStatus(issue.id, 'fixed-pending-validation')}>Marcar reparación pendiente</button>}
                              {issue.status !== 'resolved' && <button className="secondary-button" onClick={() => void changeIssueStatus(issue.id, 'resolved')}>Marcar resuelto</button>}
                              {issue.status !== 'false-positive' && <button className="secondary-button" onClick={() => void changeIssueStatus(issue.id, 'false-positive')}>Falso positivo</button>}
                            </div>
                          </article>)}
                      </section>
                    )}
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
                            {proposalInfo && <p className="helper" role="status">{proposalInfo}</p>}
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