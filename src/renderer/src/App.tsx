import { useEffect, useMemo, useRef, useState } from 'react'

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

function collectArrayMetadata(
  root: Record<string, unknown>,
  rootKeys: string[],
  maxEntries = 180
): Array<{ path: string; length: number; visibleIndices: number[] }> {
  const result: Array<{ path: string; length: number; visibleIndices: number[] }> = []
  const stack: Array<{ value: unknown; path: string[]; depth: number }> =
    rootKeys.map((key) => ({ value: root[key], path: [key], depth: 0 })).reverse()

  while (stack.length > 0 && result.length < maxEntries) {
    const current = stack.pop()!
    if (current.value === null || typeof current.value !== 'object') continue
    if (Array.isArray(current.value)) {
      const visibleCount = current.depth < 2 ? 3 : 2
      result.push({
        path: '/' + current.path.map((part) => part.replace(/~/g, '~0').replace(/\//g, '~1')).join('/'),
        length: current.value.length,
        visibleIndices: Array.from({ length: Math.min(current.value.length, visibleCount) }, (_, index) => index)
      })
      if (current.depth < 4) {
        for (let index = Math.min(current.value.length, visibleCount) - 1; index >= 0; index -= 1) {
          stack.push({ value: current.value[index], path: [...current.path, String(index)], depth: current.depth + 1 })
        }
      }
    } else if (current.depth < 4 && isRecord(current.value)) {
      const entries = Object.entries(current.value).slice(0, current.depth === 0 ? 100 : current.depth === 1 ? 30 : 18)
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const [key, value] = entries[index]
        stack.push({ value, path: [...current.path, key], depth: current.depth + 1 })
      }
    }
  }
  return result
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
interface ProposalDiffEntry {
  path: string
  before: string
  after: string
}

function buildProposalDiff(before: unknown, after: unknown, maxEntries = 12): ProposalDiffEntry[] {
  const entries: ProposalDiffEntry[] = []
  const visit = (left: unknown, right: unknown, path: string, depth: number): void => {
    if (entries.length >= maxEntries || JSON.stringify(left) === JSON.stringify(right)) return
    if (depth < 4 && isRecord(left) && isRecord(right)) {
      const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])]
      for (const key of keys) {
        if (entries.length >= maxEntries) break
        const hasLeft = Object.prototype.hasOwnProperty.call(left, key)
        const hasRight = Object.prototype.hasOwnProperty.call(right, key)
        visit(hasLeft ? left[key] : '[propiedad ausente]', hasRight ? right[key] : '[propiedad eliminada]', path ? path + '.' + key : key, depth + 1)
      }
      return
    }
    if (depth < 4 && Array.isArray(left) && Array.isArray(right)) {
      const length = Math.max(left.length, right.length)
      for (let index = 0; index < length && entries.length < maxEntries; index += 1) {
        visit(index < left.length ? left[index] : '[posición ausente]', index < right.length ? right[index] : '[posición eliminada]', path + '[' + index + ']', depth + 1)
      }
      if (left.length !== right.length && entries.length < maxEntries) entries.push({ path: path + '.length', before: String(left.length), after: String(right.length) })
      return
    }
    const render = (value: unknown): string => {
      if (typeof value === 'string') return value.length > 180 ? value.slice(0, 180) + '…' : value
      const serialized = JSON.stringify(value)
      return serialized === undefined ? String(value) : serialized.length > 180 ? serialized.slice(0, 180) + '…' : serialized
    }
    entries.push({ path: path || '(valor)', before: render(left), after: render(right) })
  }
  visit(before, after, '', 0)
  return entries
}

function assessProposalRisk(change: ProposalChange): { level: 'alto' | 'medio' | 'bajo'; reason: string } {
  const path = change.path.join('/').toLocaleLowerCase()
  if (/permission|security|auth|owner|admin|access|role|damage|health|death|combat|reward|currency|economy|spawn|drop|chance|probability|multiplier|rate/.test(path)) {
    return { level: 'alto', reason: 'La ruta afecta permisos, seguridad o una mecánica sensible del juego.' }
  }
  if (isRecord(change.previousValue) || isRecord(change.value) || Array.isArray(change.previousValue) || Array.isArray(change.value)) {
    return { level: 'alto', reason: 'El cambio altera una estructura completa y puede afectar datos dependientes.' }
  }
  if (typeof change.previousValue === 'number' || typeof change.value === 'number') {
    return { level: 'medio', reason: 'Modifica un valor numérico; revisa límites, unidades y efectos de balance.' }
  }
  return { level: 'bajo', reason: 'Cambio escalar de texto o booleano; requiere validación aunque su riesgo estimado sea menor.' }
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
  const [modsBusy, setModsBusy] = useState(false)
  const [modsOutput, setModsOutput] = useState('')
  const [usageBusy, setUsageBusy] = useState(false)
  const [usageOutput, setUsageOutput] = useState('')
  const [coverUploadBusy, setCoverUploadBusy] = useState(false)
  const [itemImageUploadBusy, setItemImageUploadBusy] = useState(false)
  const [selectedItemImageKey, setSelectedItemImageKey] = useState('')
  const [moderatedCoverUrl, setModeratedCoverUrl] = useState('')
  const [voyageWorlds, setVoyageWorlds] = useState<VoyageWorldSummary[]>([])
  const [worldTotalCount, setWorldTotalCount] = useState(0)
  const [worldMutationBusy, setWorldMutationBusy] = useState(false)
  const [newWorldTitle, setNewWorldTitle] = useState('')
  const [newWorldDescription, setNewWorldDescription] = useState('')
  const [newWorldGameState, setNewWorldGameState] = useState('{}')
  const [newWorldVisibility, setNewWorldVisibility] = useState<'private' | 'unlisted'>('private')
  const [selectedWorldId, setSelectedWorldId] = useState('')
  const [selectedWorldTitle, setSelectedWorldTitle] = useState('')
  const [selectedWorldEtag, setSelectedWorldEtag] = useState<string | null>(null)
  const [selectedWorldDocument, setSelectedWorldDocument] = useState<Record<string, unknown> | null>(null)
  const [selectedWorldJson, setSelectedWorldJson] = useState('')
  const [selectedWorldInitialGameState, setSelectedWorldInitialGameState] = useState<Record<string, unknown> | null>(null)
  const [selectedWorldDraft, setSelectedWorldDraft] = useState<Record<string, unknown> | null>(null)
  const [proposalBusy, setProposalBusy] = useState(false)
  const [proposalError, setProposalError] = useState('')
  const [proposalInfo, setProposalInfo] = useState('')
  const [proposalRawResponse, setProposalRawResponse] = useState('')
  const [proposalChanges, setProposalChanges] = useState<ProposalChange[]>([])
  const [selectedProposalPaths, setSelectedProposalPaths] = useState<string[]>([])
  const [proposalSuggestions, setProposalSuggestions] = useState<Array<{ title: string; detail: string; priority: string }>>([])
  const [worldReadBusy, setWorldReadBusy] = useState(false)
  const [worldValidationBusy, setWorldValidationBusy] = useState(false)
  const [worldValidation, setWorldValidation] = useState<{ valid: boolean; errors: Array<{ code: string; message: string; path: string }>; warnings: Array<{ code: string; message: string; path: string }>; requestId: string } | null>(null)
  const [worldValidationError, setWorldValidationError] = useState('')
  const [worldIndex, setWorldIndex] = useState<{ generatedAt: string; nodeCount: number; complete: boolean; rootKeys: string[]; relationshipCount: number; schemaDiagnostics: Array<{ code: string; severity: 'warning'; path: string; message: string; evidence: string; confidence: 'high' }> } | null>(null)
  const [indexBusy, setIndexBusy] = useState(false)
  const [indexQuery, setIndexQuery] = useState('')
  const [indexResults, setIndexResults] = useState<Array<{ path: string; key: string; kind: string; preview: string; childCount: number }>>([])
  const [relatedResults, setRelatedResults] = useState<Array<{ direction: 'outgoing' | 'incoming'; node: { path: string; key: string; kind: string; preview: string; childCount: number }; relationship: { sourcePath: string; targetPath: string; matchedValue: string; kind: 'exact-name-reference' }; matchedPath: string }>>([])
  const [trackedIssues, setTrackedIssues] = useState<Array<{ id: string; source: string; severity: string; code: string; message: string; path: string; status: string; occurrences: number; history: Array<{ at: string; action: string; detail: string }> }>>([])
  const [proposalIssueId, setProposalIssueId] = useState<string | null>(null)
  const [workspaceNotice, setWorkspaceNotice] = useState('')
  const [draftSnapshots, setDraftSnapshots] = useState<Array<{ id: string; worldId: string; createdAt: string; source: string; label: string; bytes: number; sha256: string }>>([])
  const [snapshotBusy, setSnapshotBusy] = useState(false)
  const [snapshotPreview, setSnapshotPreview] = useState<{ summary: { id: string; createdAt: string; source: string; label: string; bytes: number }; gameState: Record<string, unknown> } | null>(null)
  const [remoteRevisions, setRemoteRevisions] = useState<Array<{ id: string; createdAt: string }>>([])
  const [remoteRevisionBusy, setRemoteRevisionBusy] = useState(false)
  const [remoteRevisionPreview, setRemoteRevisionPreview] = useState<{ id: string; createdAt: string; gameState: Record<string, unknown> } | null>(null)

  const [issueReport, setIssueReport] = useState('')
  const [orderPathInput, setOrderPathInput] = useState('["npcs"]')
  const [orderKeysInput, setOrderKeysInput] = useState('')
  const [orderBusy, setOrderBusy] = useState(false)
  const apiKeyInput = useRef<HTMLInputElement>(null)
  const proposalRequestInput = useRef<HTMLTextAreaElement>(null)
  const snapshotComparison = useMemo(
    () => snapshotPreview && selectedWorldDraft ? buildProposalDiff(snapshotPreview.gameState, selectedWorldDraft, 20) : [],
    [snapshotPreview, selectedWorldDraft]
  )
  const remoteRevisionComparison = useMemo(
    () => remoteRevisionPreview && selectedWorldDraft ? buildProposalDiff(remoteRevisionPreview.gameState, selectedWorldDraft, 20) : [],
    [remoteRevisionPreview, selectedWorldDraft]
  )

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

  async function loadVoyageWorlds(): Promise<boolean> {
    if (worldListBusy || coverUploadBusy || itemImageUploadBusy) return false
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
      setSelectedWorldDocument(null)
      setSelectedWorldJson('')
      setModeratedCoverUrl('')
      setSelectedItemImageKey('')
      setSelectedWorldInitialGameState(null)
      setSelectedWorldDraft(null)
      setDraftSnapshots([])
      setSnapshotPreview(null)
      setRemoteRevisions([])
      setRemoteRevisionPreview(null)
      setProposalChanges([])
      setSelectedProposalPaths([])
      setProposalSuggestions([])
      setProposalIssueId(null)
      setProposalError('')
      setWorldValidation(null)
      setWorldValidationError('')
      setWorldListOutput('')
      return true
    } catch (error) {
      setWorldListOutput(error instanceof Error ? error.message : 'Error al consultar los mundos.')
      return false
    } finally {
      setWorldListBusy(false)
    }
  }



  async function uploadSelectedWorldCover(): Promise<void> {
    if (!selectedWorldId || !selectedWorldDocument || coverUploadBusy || worldReadBusy || worldValidationBusy) return
    if (!window.confirm('Se abrirá el selector de archivos para subir una portada a Voyage. La imagen se cargará y moderará, pero NO se guardará automáticamente en el mundo ni se publicará. La asignarás al documento local y después podrás guardarla con el flujo normal. ¿Continuar?')) return
    setCoverUploadBusy(true)
    setWorkspaceNotice('Selecciona una imagen PNG, JPG o WebP de hasta 5 MiB...')
    try {
      const result = await window.api.voyage.uploadWorldCover(selectedWorldId)
      if (result.cancelled) {
        setWorkspaceNotice('Selección de portada cancelada. No se realizó ninguna carga.')
        return
      }
      if (!result.imageUrl) throw new Error(result.error || 'Voyage no devolvió una imagen moderada.')
      setSelectedWorldDocument((current) => current ? { ...current, image: result.imageUrl } : current)
      setModeratedCoverUrl(result.imageUrl)
      setWorldValidationError('')
      setWorkspaceNotice('Imagen subida y moderada correctamente (' + result.width + '×' + result.height + ', ' + ((result.bytes || 0) / 1024).toFixed(1) + ' KiB). La portada está asignada solo al documento local. Ejecuta el guardado remoto cuando quieras aplicarla.')
    } catch (error) {
      setWorkspaceNotice(error instanceof Error ? error.message : 'No se pudo subir y moderar la portada.')
    } finally {
      setCoverUploadBusy(false)
    }
  }

  async function uploadSelectedItemImage(): Promise<void> {
    if (!selectedWorldId || !selectedWorldDraft || itemImageUploadBusy || coverUploadBusy || worldReadBusy || worldValidationBusy) return
    const itemTypes = selectedWorldDraft.itemTypes
    if (!isRecord(itemTypes) || !selectedItemImageKey || !isRecord(itemTypes[selectedItemImageKey])) {
      setWorkspaceNotice('Selecciona un objeto existente dentro de initialGameState.itemTypes.')
      return
    }
    if (!window.confirm(
      'Se subirá una imagen para "' + selectedItemImageKey +
      '" con el destino ITEM_IMAGE. Voyage la moderará; después se asignará imageUrl únicamente al borrador local. No se guardará ni publicará automáticamente. ¿Continuar?'
    )) return

    setItemImageUploadBusy(true)
    setWorkspaceNotice('Selecciona una imagen de objeto PNG, JPG o WebP de al menos 600 × 600 píxeles y hasta 5 MiB...')
    try {
      await createDraftCheckpoint('manual-checkpoint', 'Antes de asignar imagen a ' + selectedItemImageKey)
      const result = await window.api.voyage.uploadItemImage({
        shortId: selectedWorldId,
        itemKey: selectedItemImageKey
      })
      if (result.cancelled) {
        setWorkspaceNotice('Selección de imagen cancelada. No se realizó ninguna carga.')
        return
      }
      if (!result.imageUrl) throw new Error(result.error || 'Voyage no devolvió una imagen moderada.')
      const next = writePath(selectedWorldDraft, ['itemTypes', selectedItemImageKey, 'imageUrl'], result.imageUrl)
      setSelectedWorldDraft(next)
      setWorldValidation(null)
      setWorldValidationError('')
      const indexResult = await window.api.workspace.buildIndex({ worldId: selectedWorldId, gameState: next })
      if (indexResult.success && indexResult.index) setWorldIndex(indexResult.index)
      await createDraftCheckpoint('manual-checkpoint', 'Imagen moderada asignada a ' + selectedItemImageKey, next)
      await refreshDraftSnapshots(selectedWorldId)
      setWorkspaceNotice(
        'Imagen moderada (' + result.width + '×' + result.height + ', ' +
        ((result.bytes || 0) / 1024).toFixed(1) + ' KiB) asignada a itemTypes.' +
        selectedItemImageKey + '.imageUrl únicamente en el borrador local. Valida y guarda cuando quieras.'
      )
    } catch (error) {
      setWorkspaceNotice(error instanceof Error ? error.message : 'No se pudo subir y moderar la imagen del objeto.')
    } finally {
      setItemImageUploadBusy(false)
    }
  }

  async function loadVoyageMods(): Promise<void> {
    if (modsBusy || !voyageConfigured) return
    setModsBusy(true)
    setModsOutput('')
    try {
      const result = await window.api.voyage.listMods()
      if (!result.success) throw new Error(result.error || 'No se pudo consultar la lista de mods.')
      setModsOutput(JSON.stringify(result.mods, null, 2) ?? String(result.mods))
    } catch (error) {
      setModsOutput(error instanceof Error ? error.message : 'Error al consultar los mods.')
    } finally {
      setModsBusy(false)
    }
  }

  async function loadVoyageUsage(): Promise<void> {
    if (usageBusy || !voyageConfigured) return
    setUsageBusy(true)
    setUsageOutput('')
    try {
      const result = await window.api.voyage.getUsage()
      if (!result.success) throw new Error(result.error || 'No se pudo consultar el uso de Creator Studio.')
      setUsageOutput(JSON.stringify(result.usage, null, 2) ?? String(result.usage))
    } catch (error) {
      setUsageOutput(error instanceof Error ? error.message : 'Error al consultar el uso de Creator Studio.')
    } finally {
      setUsageBusy(false)
    }
  }

  async function createVoyageWorld(): Promise<void> {
    if (worldMutationBusy || !voyageConfigured) return
    const title = newWorldTitle.trim()
    if (!title) {
      setVoyageNotice('Introduce un título para el nuevo mundo.')
      return
    }
    let initialGameState: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(newWorldGameState)
      if (!isRecord(parsed)) throw new Error('El GameState debe ser un objeto JSON, no un array ni un valor simple.')
      initialGameState = parsed
    } catch (error) {
      setVoyageNotice(error instanceof Error ? error.message : 'El GameState inicial no es JSON válido.')
      return
    }

    if (!window.confirm('Se creará un mundo nuevo en tu cuenta de Voyage con el título "' + title + '". No se publicará automáticamente. ¿Continuar?')) return
    setWorldMutationBusy(true)
    setVoyageNotice('Creando mundo en Voyage...')
    try {
      const result = await window.api.voyage.createWorld({
        title,
        description: newWorldDescription.trim() || null,
        initialGameState,
        visibility: newWorldVisibility
      })
      if (!result.success) {
        throw new Error(result.error || 'Voyage no confirmó la creación.')
      }
      setNewWorldTitle('')
      setNewWorldDescription('')
      setNewWorldGameState('{}')
      setVoyageNotice('Voyage aceptó la creación del mundo. Actualizando la lista...')
      const refreshed = await loadVoyageWorlds()
      setVoyageNotice(refreshed
        ? 'Mundo creado. Revisa la lista de mundos para abrirlo. No fue publicado.'
        : 'Voyage aceptó la creación, pero no se pudo actualizar la lista. Consulta tus mundos manualmente antes de repetir la operación.')
    } catch (error) {
      setVoyageNotice(
        (error instanceof Error ? error.message : 'No se pudo crear el mundo.') +
        ' Si la conexión falló durante la solicitud, consulta primero la lista de mundos antes de intentar crear otro para evitar duplicados.'
      )
    } finally {
      setWorldMutationBusy(false)
    }
  }

  async function duplicateVoyageWorld(world: VoyageWorldSummary): Promise<void> {
    if (worldMutationBusy || !voyageConfigured) return
    if (!window.confirm(
      'Se creará una copia independiente de "' + world.title +
      '". El mundo original no se modificará y la copia no se publicará automáticamente. ¿Duplicar?'
    )) return
    setWorldMutationBusy(true)
    setVoyageNotice('Duplicando "' + world.title + '" en Voyage...')
    try {
      const result = await window.api.voyage.duplicateWorld(world.shortId)
      if (!result.success) throw new Error(result.error || 'Voyage no confirmó la duplicación.')
      setVoyageNotice('Voyage aceptó la duplicación. Actualizando la lista...')
      const refreshed = await loadVoyageWorlds()
      setVoyageNotice(refreshed
        ? 'Copia creada. Revisa la lista y abre el nuevo mundo. El original permanece intacto; la copia no fue publicada.'
        : 'Voyage aceptó la duplicación, pero no se pudo actualizar la lista. Consulta tus mundos manualmente antes de repetirla.')
    } catch (error) {
      setVoyageNotice(
        (error instanceof Error ? error.message : 'No se pudo duplicar el mundo.') +
        ' Si la conexión falló durante la solicitud, consulta primero la lista de mundos antes de repetir la operación.'
      )
    } finally {
      setWorldMutationBusy(false)
    }
  }

  async function openVoyageWorld(world: VoyageWorldSummary): Promise<void> {
    if (worldReadBusy || coverUploadBusy || itemImageUploadBusy) return
    setWorldReadBusy(true)
    setSelectedWorldId(world.shortId)
    setSelectedWorldTitle(world.title)
    setSelectedWorldEtag(null)
    setSelectedWorldDocument(null)
    setSelectedWorldJson('')
    setModeratedCoverUrl('')
    setSelectedItemImageKey('')
    setSelectedWorldInitialGameState(null)
    setSelectedWorldDraft(null)
    setWorldIndex(null)
    setIndexQuery('')
    setIndexResults([])
    setRelatedResults([])
    setTrackedIssues([])
    setDraftSnapshots([])
    setSnapshotPreview(null)
    setRemoteRevisions([])
    setRemoteRevisionPreview(null)
    setIssueReport('')
    setWorkspaceNotice('')
    setProposalChanges([])
    setSelectedProposalPaths([])
    setProposalSuggestions([])
    setProposalIssueId(null)
    setProposalError('')
    setWorldValidation(null)
    setWorldValidationError('')
    try {
      const result = await window.api.voyage.readWorld(world.shortId)
      if (!result.success || !result.world) {
        throw new Error(result.error || 'No se pudo descargar el documento del mundo.')
      }
      setSelectedWorldEtag(result.etag ?? null)
      setSelectedWorldDocument(JSON.parse(JSON.stringify(result.world)) as Record<string, unknown>)
      setSelectedWorldInitialGameState(result.world.initialGameState)
      setSelectedWorldDraft(JSON.parse(JSON.stringify(result.world.initialGameState)) as Record<string, unknown>)
      try {
        await createDraftCheckpoint('world-opened', 'Estado descargado de Voyage', JSON.parse(JSON.stringify(result.world.initialGameState)) as Record<string, unknown>, world.shortId)
      } catch (snapshotError) {
        setWorkspaceNotice(snapshotError instanceof Error ? snapshotError.message : 'No se pudo crear el snapshot inicial.')
      }
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
      await refreshDraftSnapshots(world.shortId).catch((snapshotError) => setWorkspaceNotice(snapshotError instanceof Error ? snapshotError.message : 'No se pudo leer el historial.'))
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


  async function refreshDraftSnapshots(worldId = selectedWorldId): Promise<void> {
    if (!worldId) return
    const result = await window.api.workspace.listDraftSnapshots(worldId)
    if (!result.success) throw new Error(result.error || 'No se pudo leer el historial de borradores.')
    setDraftSnapshots(result.snapshots)
  }

  async function createDraftCheckpoint(
    source: 'world-opened' | 'manual-checkpoint' | 'before-proposal' | 'proposal-applied' | 'draft-reset' | 'before-restore' | 'remote-saved',
    label: string,
    gameState = selectedWorldDraft,
    worldId = selectedWorldId
  ): Promise<void> {
    if (!worldId || !gameState) return
    const result = await window.api.workspace.createDraftSnapshot({
      worldId, gameState, source, label
    })
    if (!result.success) throw new Error(result.error || 'No se pudo guardar el snapshot local.')
    await refreshDraftSnapshots(worldId)
  }

  async function inspectDraftSnapshot(snapshotId: string): Promise<void> {
    if (!selectedWorldId) return
    setSnapshotBusy(true)
    try {
      const result = await window.api.workspace.readDraftSnapshot({ worldId: selectedWorldId, snapshotId })
      if (!result.success || !result.snapshot) throw new Error(result.error || 'No se pudo leer el snapshot.')
      setSnapshotPreview(result.snapshot)
    } catch (error) {
      setWorkspaceNotice(error instanceof Error ? error.message : 'No se pudo inspeccionar el snapshot.')
    } finally {
      setSnapshotBusy(false)
    }
  }

  async function restoreDraftSnapshot(snapshotId: string): Promise<void> {
    if (coverUploadBusy || itemImageUploadBusy || !selectedWorldId || snapshotBusy) return
    const confirmed = window.confirm('Se reemplazará el borrador que tienes actualmente en memoria por el snapshot seleccionado. Se conservará primero una copia del estado actual. No se modificará Voyage. ¿Continuar?')
    if (!confirmed) return
    setSnapshotBusy(true)
    try {
      // Read and verify the target before creating a checkpoint, because retention may prune the oldest entry.
      const result = await window.api.workspace.readDraftSnapshot({ worldId: selectedWorldId, snapshotId })
      if (!result.success || !result.snapshot) throw new Error(result.error || 'No se pudo restaurar el snapshot.')
      if (selectedWorldDraft) await createDraftCheckpoint('before-restore', 'Copia automática antes de restaurar')
      const restored = JSON.parse(JSON.stringify(result.snapshot.gameState)) as Record<string, unknown>
      setSelectedWorldDraft(restored)
      const indexResult = await window.api.workspace.buildIndex({ worldId: selectedWorldId, gameState: restored })
      if (indexResult.success && indexResult.index) setWorldIndex(indexResult.index)
      setProposalChanges([])
      setSelectedProposalPaths([])
      setProposalSuggestions([])
      setProposalIssueId(null)
      setProposalError('')
      setWorldValidation(null)
      setWorldValidationError('')
      setSelectedWorldJson('')
      setSnapshotPreview(null)
      await refreshDraftSnapshots(selectedWorldId)
      setWorkspaceNotice('Snapshot restaurado al borrador local. El mundo remoto no fue modificado; valida antes de guardar.')
    } catch (error) {
      setWorkspaceNotice(error instanceof Error ? error.message : 'No se pudo restaurar el snapshot.')
    } finally {
      setSnapshotBusy(false)
    }
  }

  async function loadRemoteRevisions(): Promise<void> {
    if (!selectedWorldId || remoteRevisionBusy) return
    setRemoteRevisionBusy(true)
    setWorkspaceNotice('Consultando el historial remoto de Voyage...')
    try {
      const result = await window.api.voyage.listRevisions(selectedWorldId)
      if (!result.success || !result.revisions) throw new Error(result.error || 'No se pudo consultar el historial remoto.')
      setRemoteRevisions(result.revisions)
      setRemoteRevisionPreview(null)
      setWorkspaceNotice(`Historial remoto recibido: ${result.revisions.length} revisión(es). La lista es de solo lectura.`)
    } catch (error) {
      setWorkspaceNotice(error instanceof Error ? error.message : 'No se pudo consultar el historial remoto.')
    } finally {
      setRemoteRevisionBusy(false)
    }
  }

  async function inspectRemoteRevision(revision: { id: string; createdAt: string }): Promise<void> {
    if (!selectedWorldId || remoteRevisionBusy) return
    setRemoteRevisionBusy(true)
    try {
      const result = await window.api.voyage.readRevision({ shortId: selectedWorldId, revisionId: revision.id })
      if (!result.success || !result.revision) throw new Error(result.error || 'No se pudo descargar la revisión remota.')
      setRemoteRevisionPreview({ id: revision.id, createdAt: revision.createdAt, gameState: result.revision.initialGameState })
      setWorkspaceNotice('Revisión remota descargada para comparación. No se modificó el borrador ni Voyage.')
    } catch (error) {
      setWorkspaceNotice(error instanceof Error ? error.message : 'No se pudo descargar la revisión remota.')
    } finally {
      setRemoteRevisionBusy(false)
    }
  }

  async function restoreRemoteRevisionInVoyage(): Promise<void> {
    if (coverUploadBusy || itemImageUploadBusy || !selectedWorldId || !remoteRevisionPreview || remoteRevisionBusy) return
    const confirmed = window.confirm(
      'ATENCIÓN: se reemplazará el contenido activo de "' + selectedWorldTitle +
      '" por la revisión histórica seleccionada. Voyage creará una NUEVA revisión activa; no borra el historial ni publica el mundo. ' +
      'La operación afecta al servidor y no se puede deshacer automáticamente. ¿Restaurar esta revisión en Voyage?'
    )
    if (!confirmed) return

    setRemoteRevisionBusy(true)
    setWorkspaceNotice('Restaurando la revisión histórica en Voyage...')
    setWorldValidation(null)
    setWorldValidationError('')
    let remoteRestoreConfirmed = false
    try {
      if (selectedWorldDraft) {
        await createDraftCheckpoint('before-restore', 'Copia local previa a restauración remota')
      }
      const result = await window.api.voyage.restoreRevision({
        shortId: selectedWorldId,
        revisionId: remoteRevisionPreview.id
      })
      if (!result.success || !result.restored) {
        throw new Error(result.error || 'Voyage no confirmó la restauración.')
      }
      remoteRestoreConfirmed = true

      if (!result.world || !isRecord(result.world.initialGameState)) {
        setSelectedWorldEtag(null)
        setSelectedWorldDocument(null)
        setWorldValidation(null)
        setWorkspaceNotice(
          'Voyage confirmó la restauración, pero no se pudo volver a leer el mundo. No intentes otra restauración todavía. ' +
          (result.refreshError || 'Cierra y vuelve a abrir el mundo para comprobar el estado actual.')
        )
        return
      }

      const refreshedDocument = JSON.parse(JSON.stringify(result.world)) as Record<string, unknown>
      const refreshedState = JSON.parse(JSON.stringify(result.world.initialGameState)) as Record<string, unknown>
      setSelectedWorldDocument(refreshedDocument)
      setSelectedWorldInitialGameState(refreshedState)
      setSelectedWorldDraft(JSON.parse(JSON.stringify(refreshedState)) as Record<string, unknown>)
      setSelectedWorldJson('')
      setSelectedWorldEtag(result.etag ?? null)
      setWorldValidation(null)
      setWorldValidationError('')
      setProposalChanges([])
      setSelectedProposalPaths([])
      setProposalSuggestions([])
      setProposalIssueId(null)
      setProposalError('')
      const indexResult = await window.api.workspace.buildIndex({ worldId: selectedWorldId, gameState: refreshedState })
      if (indexResult.success && indexResult.index) setWorldIndex(indexResult.index)
      await createDraftCheckpoint('remote-saved', 'Estado confirmado tras restauración remota', refreshedState)
        .catch((error) => setWorkspaceNotice(error instanceof Error ? error.message : 'No se pudo guardar el snapshot posterior a la restauración.'))
      await refreshDraftSnapshots(selectedWorldId)
      setRemoteRevisionPreview(null)
      setWorkspaceNotice('Revisión histórica restaurada en Voyage como nueva revisión activa. El estado se volvió a leer y el índice local se actualizó. El mundo NO fue publicado.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo restaurar la revisión remota.'
      if (remoteRestoreConfirmed) {
        setWorkspaceNotice(
          'Voyage confirmó la restauración, pero falló una actualización local posterior: ' + message +
          ' El contenido remoto ya fue restaurado; vuelve a abrir el mundo para sincronizar la interfaz.'
        )
      } else {
        // The outcome may be uncertain after a network failure; force a fresh read before any later save.
        setSelectedWorldEtag(null)
        setSelectedWorldDocument(null)
        setSelectedWorldJson('')
        setWorkspaceNotice(
          message + ' Vuelve a abrir el mundo para comprobar el estado actual antes de guardar o repetir la restauración.'
        )
      }
      await window.api.workspace.recordIssue({
        worldId: selectedWorldId, source: 'application', severity: 'error',
        code: remoteRestoreConfirmed ? 'VOYAGE_REVISION_RESTORE_POSTPROCESS_FAILURE' : 'VOYAGE_REVISION_RESTORE_FAILURE',
        message, path: ''
      }).catch(() => undefined)
      const issueResult = await window.api.workspace.listIssues(selectedWorldId)
      if (issueResult.success) setTrackedIssues(issueResult.issues)
    } finally {
      setRemoteRevisionBusy(false)
    }
  }

  async function copyRemoteRevisionToLocalDraft(): Promise<void> {
    if (!selectedWorldId || !selectedWorldDraft || !remoteRevisionPreview || remoteRevisionBusy) return
    const confirmed = window.confirm('Se reemplazará el borrador local en memoria por el contenido de esta revisión remota. Se guardará antes un checkpoint local. Esto NO restaura ni guarda nada en Voyage. ¿Continuar?')
    if (!confirmed) return
    setRemoteRevisionBusy(true)
    try {
      await createDraftCheckpoint('before-restore', 'Copia local previa a importar revisión remota')
      const imported = JSON.parse(JSON.stringify(remoteRevisionPreview.gameState)) as Record<string, unknown>
      setSelectedWorldDraft(imported)
      const indexResult = await window.api.workspace.buildIndex({ worldId: selectedWorldId, gameState: imported })
      if (indexResult.success && indexResult.index) setWorldIndex(indexResult.index)
      setProposalChanges([])
      setSelectedProposalPaths([])
      setProposalSuggestions([])
      setProposalIssueId(null)
      setProposalError('')
      setWorldValidation(null)
      setWorldValidationError('')
      setSelectedWorldJson('')
      await createDraftCheckpoint('before-restore', 'Contenido de revisión remota importado al borrador local', imported)
        .catch((error) => setWorkspaceNotice(error instanceof Error ? error.message : 'No se pudo guardar el snapshot posterior a la importación.'))
      await refreshDraftSnapshots(selectedWorldId)
      setWorkspaceNotice('Revisión remota copiada al borrador local. Voyage no fue modificado; valida antes de cualquier guardado remoto.')
    } catch (error) {
      setWorkspaceNotice(error instanceof Error ? error.message : 'No se pudo importar la revisión al borrador local.')
    } finally {
      setRemoteRevisionBusy(false)
    }
  }


  async function reorderSelectedWorldObject(): Promise<void> {
    if (coverUploadBusy || itemImageUploadBusy || !selectedWorldId || !selectedWorldDraft || !selectedWorldInitialGameState || orderBusy || worldReadBusy || worldValidationBusy) return
    if (moderatedCoverUrl) {
      setWorkspaceNotice('Hay una portada moderada pendiente de guardar en el documento local. Guarda o descarta esa portada antes de reordenar claves remotas.')
      return
    }
    if (JSON.stringify(selectedWorldDraft) !== JSON.stringify(selectedWorldInitialGameState)) {
      setWorkspaceNotice('Hay cambios locales pendientes. Guarda o descarta esos cambios antes de reordenar claves remotas.')
      return
    }
    let pathValue: unknown
    try { pathValue = JSON.parse(orderPathInput) }
    catch { setWorkspaceNotice('La ruta debe ser un array JSON válido, por ejemplo ["npcs","Guide"].'); return }
    if (!Array.isArray(pathValue) || pathValue.length < 1 || pathValue.length > 100 || pathValue.some((part) => typeof part !== 'string')) {
      setWorkspaceNotice('La ruta debe ser un array JSON de entre 1 y 100 segmentos de texto.')
      return
    }
    const pathSegments = pathValue as string[]
    const target = readPath(selectedWorldDraft, pathSegments)
    if (!target.exists || !isRecord(target.value)) {
      setWorkspaceNotice('La ruta no apunta a un objeto JSON existente. No se admiten arrays ni valores escalares.')
      return
    }
    const targetObject = target.value
    const keys = orderKeysInput.split(/\r?\n/).map((key) => key.trim()).filter(Boolean)
    if (new Set(keys).size !== keys.length || keys.some((key) => !Object.prototype.hasOwnProperty.call(targetObject, key))) {
      setWorkspaceNotice('Las claves deben ser únicas y existir en el objeto seleccionado.')
      return
    }
    const currentKeys = Object.keys(targetObject)
    const previewKeys = [...keys, ...currentKeys.filter((key) => !keys.includes(key))]
    if (JSON.stringify(currentKeys) === JSON.stringify(previewKeys)) {
      setWorkspaceNotice('El orden solicitado ya coincide con el orden actual. No se envió ninguna solicitud.')
      return
    }
    if (!window.confirm('Se cambiará únicamente el orden de las claves del objeto remoto en "' + selectedWorldTitle + '". No se reemplazarán ni editarán valores. Las claves omitidas conservarán su orden relativo y quedarán al final. Se usará el ETag más reciente de Voyage. ¿Continuar?')) return
    setOrderBusy(true)
    setWorkspaceNotice('Guardando el orden de claves en Voyage...')
    try {
      await createDraftCheckpoint('manual-checkpoint', 'Checkpoint previo al reordenamiento remoto')
      const result = await window.api.voyage.reorderObjectKeys({ shortId: selectedWorldId, path: pathSegments, keys })
      if (!result.success || !result.reordered) throw new Error(result.error || 'Voyage no confirmó el reordenamiento.')
      if (!result.world || !isRecord(result.world.initialGameState)) {
        setSelectedWorldEtag(null)
        setWorldValidation(null)
        setWorkspaceNotice('Voyage confirmó el reordenamiento, pero no se pudo verificar la lectura posterior. Vuelve a abrir el mundo antes de otra operación remota. ' + (result.refreshError || ''))
        return
      }
      const refreshedDocument = JSON.parse(JSON.stringify(result.world)) as Record<string, unknown>
      const refreshedState = JSON.parse(JSON.stringify(result.world.initialGameState)) as Record<string, unknown>
      setSelectedWorldDocument(refreshedDocument)
      setSelectedWorldInitialGameState(refreshedState)
      setSelectedWorldDraft(JSON.parse(JSON.stringify(refreshedState)) as Record<string, unknown>)
      setSelectedWorldEtag(result.etag ?? null)
      setWorldValidation(null)
      setWorldValidationError('')
      setProposalChanges([])
      setSelectedProposalPaths([])
      setProposalSuggestions([])
      setProposalError('')
      setSelectedWorldJson('')
      const indexResult = await window.api.workspace.buildIndex({ worldId: selectedWorldId, gameState: refreshedState })
      if (indexResult.success && indexResult.index) setWorldIndex(indexResult.index)
      await createDraftCheckpoint('remote-saved', 'Orden de claves confirmado en Voyage', refreshedState)
        .catch((error) => setWorkspaceNotice(error instanceof Error ? error.message : 'No se pudo guardar el snapshot posterior.'))
      setWorkspaceNotice('Orden de claves confirmado y releído desde Voyage. Los valores no fueron reemplazados; no se publicó el mundo.')
    } catch (error) {
      setSelectedWorldEtag(null)
      setWorldValidation(null)
      const message = error instanceof Error ? error.message : 'No se pudo confirmar el reordenamiento.'
      setWorkspaceNotice(message + ' El ETag local quedó invalidado: vuelve a abrir el mundo antes de reintentar.')
    } finally {
      setOrderBusy(false)
    }
  }

  async function saveSelectedWorld(): Promise<void> {
    if (coverUploadBusy || itemImageUploadBusy) return
    if (!selectedWorldId || !selectedWorldDocument || !selectedWorldDraft || !selectedWorldEtag) {
      setWorldValidationError('No se puede guardar: falta el documento original o su ETag. Vuelve a abrir el mundo.')
      return
    }
    if (!worldValidation?.valid) {
      setWorldValidationError('Antes de guardar, ejecuta una validación correcta del borrador actual.')
      return
    }
    const confirmed = window.confirm(
      'Vas a reemplazar el borrador remoto de "' + selectedWorldTitle + '" con el borrador local validado. Esta acción modifica el mundo en Voyage Creator Studio, pero NO lo publica. ¿Continuar?'
    )
    if (!confirmed) return

    setWorldValidationError('')
    setWorldValidationBusy(true)
    try {
      const world = {
        ...selectedWorldDocument,
        shortId: selectedWorldId,
        initialGameState: selectedWorldDraft
      }
      const result = await window.api.voyage.saveWorld({
        shortId: selectedWorldId,
        etag: selectedWorldEtag,
        world
      })
      if (!result.success || !result.saved) throw new Error(result.error || 'Voyage no confirmó el guardado.')
      if (result.world && isRecord(result.world.initialGameState)) {
        const refreshedDocument = JSON.parse(JSON.stringify(result.world)) as Record<string, unknown>
        const refreshedState = JSON.parse(JSON.stringify(result.world.initialGameState)) as Record<string, unknown>
        setSelectedWorldDocument(refreshedDocument)
        setModeratedCoverUrl('')
        setSelectedWorldInitialGameState(refreshedState)
        setSelectedWorldDraft(JSON.parse(JSON.stringify(refreshedState)) as Record<string, unknown>)
        await createDraftCheckpoint('remote-saved', 'Estado confirmado tras guardado remoto', refreshedState).catch((error) => setWorkspaceNotice(error instanceof Error ? error.message : 'No se pudo guardar el snapshot del estado remoto.'))
        setSelectedWorldEtag(result.etag ?? null)
        const indexResult = await window.api.workspace.buildIndex({ worldId: selectedWorldId, gameState: refreshedState })
        if (indexResult.success && indexResult.index) setWorldIndex(indexResult.index)
        setWorldValidation(null)
        setProposalChanges([])
        setSelectedProposalPaths([])
        setProposalSuggestions([])
        setProposalError('')
        setWorldValidationError('El borrador remoto se guardó y se volvió a leer correctamente. No se publicó.')
      } else {
        setSelectedWorldEtag(result.etag ?? null)
        setWorldValidation(null)
        setWorldValidationError(
          'Voyage confirmó el guardado, pero no se pudo volver a leer el documento para verificarlo. ' +
          (result.refreshError || 'Vuelve a abrir el mundo antes de realizar otro guardado.') +
          ' El mundo no fue publicado.'
        )
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo guardar el borrador remoto.'
      setWorldValidationError(message)
      await window.api.workspace.recordIssue({
        worldId: selectedWorldId, source: 'application', severity: 'error',
        code: 'VOYAGE_WORLD_SAVE_FAILURE', message, path: ''
      }).catch(() => undefined)
      const issueResult = await window.api.workspace.listIssues(selectedWorldId)
      if (issueResult.success) setTrackedIssues(issueResult.issues)
    } finally {
      setWorldValidationBusy(false)
    }
  }

  async function validateSelectedWorld(): Promise<void> {
    if (coverUploadBusy || itemImageUploadBusy || !selectedWorldInitialGameState || worldValidationBusy) return
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

  async function showNodeRelations(path: string): Promise<void> {
    setRelatedResults([])
    const result = await window.api.workspace.relatedNodes({ worldId: selectedWorldId, paths: [path], limit: 60 })
    if (result.success) {
      setRelatedResults(result.results)
      setWorkspaceNotice(result.results.length ? '' : 'No se encontraron relaciones por coincidencia exacta para esta ruta.')
    } else setWorkspaceNotice(result.error || 'No se pudieron consultar las relaciones.')
  }

  async function changeIssueStatus(issueId: string, status: 'investigating' | 'fixed-pending-validation' | 'resolved' | 'false-positive'): Promise<void> {
    const result = await window.api.workspace.updateIssue({ worldId: selectedWorldId, issueId, status, detail: 'Estado actualizado desde la interfaz.' })
    if (result.success && result.issues) setTrackedIssues(result.issues)
    else setWorkspaceNotice(result.error || 'No se pudo actualizar el problema.')
  }

  async function generateWorldProposal(
    mode: 'request' | 'recommend' | 'repair' = 'request',
    targetIssue?: (typeof trackedIssues)[number],
    attempt = 1,
    previousAttemptFailure = ''
  ): Promise<void> {
    if (!selectedWorldDraft || !selectedModel || (proposalBusy && attempt === 1)) return
    if (mode === 'repair' && !targetIssue && (!worldValidation || worldValidation.errors.length === 0)) return
    const userRequest = proposalRequestInput.current?.value.trim() || ''
    if (mode === 'request' && !userRequest) return
    setProposalBusy(true)
    setProposalError('')
    setProposalInfo(attempt > 1 ? 'Recomendación: intento ' + attempt + ' de 3. Motivo del reintento anterior: ' + previousAttemptFailure : '')
    setProposalRawResponse('')
    setProposalChanges([])
    setProposalSuggestions([])
    setProposalIssueId(targetIssue?.id || null)
    try {
      const task = mode === 'recommend'
        ? 'Analiza el mundo y recomienda entre 5 y 8 mejoras concretas, específicas y aplicables: reparaciones, coherencia, contenido, profundidad, sistemas, balance y oportunidades de expansión. Evita consejos genéricos. Cada recomendación debe mencionar una sección o sistema real del mundo y explicar un beneficio claro. No inventes funciones que el esquema no admita.' + (attempt > 1 ? ' Este es el intento ' + attempt + ' de 3 porque el intento anterior no produjo recomendaciones utilizables. Diagnóstico anterior: ' + previousAttemptFailure + '. Reevalúa otras secciones, usa el contexto del índice y busca ideas concretas distintas; no repitas una respuesta vacía.' : '')
        : mode === 'repair'
          ? targetIssue
            ? 'Investiga y propone la corrección mínima para el problema registrado indicado. Usa su ruta exacta y el fragmento del borrador cuando estén disponibles. No modifiques datos no relacionados; si no hay evidencia suficiente, explica la limitación sin inventar campos.'
            : 'Corrige los errores de validación indicados usando solo rutas y estructuras compatibles con el GameState actual. Si un problema no puede corregirse con el documento disponible, explícalo en una sugerencia y no inventes campos.'
          : 'Implementa la intención del usuario mediante cambios concretos en cualquier sección pertinente. Decide dónde corresponde cada cambio; no estás limitado a una sección. Si la función no puede expresarse con el GameState disponible, explica la limitación en suggestions.'
      const validationContext = worldValidation
        ? JSON.stringify({ errors: worldValidation.errors, warnings: worldValidation.warnings })
        : 'Sin resultados de validación.'
      const targetIssueContext = targetIssue ? JSON.stringify({
        id: targetIssue.id, source: targetIssue.source, severity: targetIssue.severity,
        code: targetIssue.code, message: targetIssue.message, path: targetIssue.path,
        status: targetIssue.status, occurrences: targetIssue.occurrences
      }) : ''
      const targetPathSegments = targetIssue?.path
        ? (targetIssue.path.startsWith('/') ? targetIssue.path.slice(1) : targetIssue.path).split('/').map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
        : []
      const targetPathValue = targetPathSegments.length ? readPath(selectedWorldDraft, targetPathSegments) : null
      const sectionKeys = Object.keys(selectedWorldDraft)
      const structuralSummary = summarizeForAI(selectedWorldDraft)
      const retrievalText = mode === 'repair'
        ? [validationContext, targetIssueContext].join(' ')
        : mode === 'recommend' ? 'factions locations NPCs skills resources items quests combat progression settings world lore' : userRequest
      const retrievalTerms = [...new Set((retrievalText.toLocaleLowerCase().match(/[\\p{L}\\p{N}_-]{4,}/gu) || []).slice(0, 10))].join(' ')
      const indexLookup = await window.api.workspace.searchIndex({ worldId: selectedWorldId, query: retrievalTerms, limit: 80 })
      const indexMatches = indexLookup.success ? indexLookup.results.slice(0, 35) : []
      const relationLookup = await window.api.workspace.relatedNodes({
        worldId: selectedWorldId, paths: indexMatches.slice(0, 12).map((item) => item.path), limit: 80
      })
      const relationshipMatches = relationLookup.success ? relationLookup.results.map((entry) => ({
        path: entry.node.path, key: entry.node.key, kind: entry.node.kind,
        preview: entry.node.preview, childCount: entry.node.childCount,
        direction: entry.direction, matchedValue: entry.relationship.matchedValue,
        relatedFrom: entry.matchedPath
      })) : []
      const contextNodes: typeof indexMatches = [...indexMatches]
      for (const related of relationshipMatches) {
        if (!contextNodes.some((item) => item.path === related.path)) contextNodes.push(related)
      }
      if (targetIssue?.path && targetPathValue?.exists && !contextNodes.some((item) => item.path === targetIssue.path)) {
        contextNodes.unshift({
          path: targetIssue.path, key: targetPathSegments[targetPathSegments.length - 1],
          kind: Array.isArray(targetPathValue.value) ? 'array' : isRecord(targetPathValue.value) ? 'object' : typeof targetPathValue.value,
          preview: JSON.stringify({ issue: targetIssue.code, message: targetIssue.message, value: summarizeForAI(targetPathValue.value, 0, { remaining: 2500 }) }).slice(0, 1800),
          childCount: 0
        })
      }
      const retrievalBudget = { remaining: 18000 }
      const retrievedFragments = contextNodes.slice(0, 25).map((item) => {
        const path = item.path ? item.path.slice(1).split('/').map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~')) : []
        const found = readPath(selectedWorldDraft, path)
        return { path: item.path, value: found.exists ? summarizeForAI(found.value, 0, retrievalBudget) : item.preview }
      })
      const indexedRootKeys = [...new Set(contextNodes.map((item) => item.path.split('/')[1]?.replace(/~1/g, '/').replace(/~0/g, '~')).filter((key): key is string => Boolean(key) && sectionKeys.includes(key)))]
      const targetRootKey = targetPathSegments[0]
      const selectionPrompt = [
        'Eres un analista de mundos de Voyage Creator Studio.',
        'Elige las secciones raíz más relevantes para esta tarea. Devuelve solo JSON: {"sections":["claveRaiz"],"reason":"motivo breve"}.',
        'Elige entre 1 y 5 claves EXACTAS de la lista disponible. No inventes nombres. No selecciones todo.',
        'Claves disponibles: ' + JSON.stringify(sectionKeys),
        'TAREA: ' + task,
        'ESTADO DEL ÍNDICE LOCAL: ' + (worldIndex?.complete ? 'completo' : 'parcial o no disponible') + '. El índice es una ayuda de recuperación, no sustituye al GameState.',
        'PISTAS DEL ÍNDICE LOCAL (búsqueda textual y relaciones exactas no ambiguas; los enlaces son pistas, no prueba semántica): ' + JSON.stringify({ indexedRootKeys, matches: indexMatches, relationshipMatches }),
        mode === 'request' ? 'PETICIÓN DEL USUARIO: ' + userRequest : '',
        mode === 'repair' ? 'RESULTADO DE VALIDACIÓN: ' + validationContext : '',
        targetIssue ? 'PROBLEMA CONCRETO A INVESTIGAR Y REPARAR: ' + targetIssueContext : '',
        targetIssue?.path ? 'RUTA EXACTA DEL PROBLEMA: ' + targetIssue.path + '. Prioriza esta sección raíz: ' + (targetRootKey || 'no determinada') : '',
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
      const modelSelectedKeys = selection.sections.filter((key): key is string => typeof key === 'string' && sectionKeys.includes(key))
      const selectedKeys = [...new Set([
        ...(mode === 'repair' && targetRootKey && sectionKeys.includes(targetRootKey) ? [targetRootKey] : []),
        ...modelSelectedKeys
      ])].slice(0, 5)
      if (selectedKeys.length === 0) throw new Error('La IA no seleccionó ninguna sección válida del mundo. Reintenta o formula una petición más concreta.')
      const sectionBudget = { remaining: 65000 }
      const focusedWorld = Object.fromEntries(selectedKeys.map((key) => [key, summarizeForAI(selectedWorldDraft[key], 0, sectionBudget)]))
      const instruction = [
        'Eres un arquitecto experto en Voyage Creator Studio y en el GameState del mundo proporcionado.',
        'REGLAS DE PROPIEDAD CANÓNICA CREATOR API PREVIEW 1.3: los campos compartidos permanecen en la raíz de initialGameState; quests, arcs, narrativeEvents y estado de grupo pertenecen a parties[partyId]; las definiciones de triggers compartidos usan triggerDefinitions. No muevas ni dupliques contenido entre estos ámbitos. Si la estructura existente no permite confirmar el partyId o la propiedad, no inventes rutas y explica la limitación en suggestions.',
        'Recibes un resumen estructural de las secciones elegidas, no el documento completo. No propongas cambios sobre datos que no aparecen.',
        'Devuelve exclusivamente JSON válido, sin Markdown.',
        'Formato exacto: {"changes":[{"path":"/seccion/propiedad","value":"valor","reason":"justificación","category":"mejora|reparación|contenido|coherencia|balance|sistema"}],"suggestions":[{"title":"título","detail":"explicación","priority":"alta|media|baja"}]}.',
        'path es un JSON Pointer en texto, NO un array. Ejemplo: /factions/Helix Dominion/basicInfo. Escapa ~ como ~0 y / como ~1 dentro de cada nombre de clave. Mantén value, reason y category como propiedades hermanas de path.',
        'No generes cambios de eliminación; si un campo debe retirarse, deja changes vacío y explícalo en suggestions.',
        'Los paths deben señalar ubicaciones reales visibles en el resumen. No uses __summary_omitted_keys ni inventes campos. Los arrays muestran solo sus primeros elementos; usa únicamente índices visibles.',
        'El padre de cada ruta debe existir en el GameState original. No inventes propiedades raíz, campos de configuración ni identificadores.',
        'Conserva exactamente el tipo JSON original de cada campo: number debe seguir siendo number sin comillas, boolean debe seguir siendo boolean, string debe seguir siendo string, array y object deben conservar su estructura. Nunca serialices números como cadenas.',
        'No inventes niveles, claves ni rutas anidadas. Antes de proponer un path, comprueba que todos sus segmentos padre existen literalmente en los datos recibidos. Si no puedes verificarlo, omite ese cambio.',
        'Conserva tipos, estructuras, IDs y convenciones. No conviertas etiquetas descriptivas en IDs. No reemplaces arrays completos salvo necesidad demostrable.',
        'No uses segmentos "__proto__", "prototype" ni "constructor". Máximo 30 cambios y 8 sugerencias. Evita duplicar cambios ya presentes.',
        'Prioriza propuestas pequeñas, coherentes y verificables. Si la información resumida no basta para proponer un cambio seguro, deja changes vacío y explica la limitación en suggestions.',
        '',
        'TAREA:', task,
        mode === 'request' ? 'PETICIÓN DEL USUARIO: ' + userRequest : '',
        mode === 'repair' ? 'RESULTADO DE VALIDACIÓN: ' + validationContext : '',
        targetIssue ? 'REPARACIÓN DIRIGIDA: ' + targetIssueContext : '',
        targetIssue?.path ? 'Debes concentrarte primero en la ruta exacta ' + targetIssue.path + '. No modifiques otras secciones salvo que la causa lo exija y exista evidencia en el contexto.' : '',
        'SECCIONES SELECCIONADAS: ' + selectedKeys.join(', '),
        'FRAGMENTOS RECUPERADOS DEL ÍNDICE Y SU GRAFO (datos leídos desde rutas exactas del borrador actual; las relaciones se infieren solo por coincidencia exacta de nombre): ' + JSON.stringify(retrievedFragments.filter((item) => selectedKeys.includes(item.path.split('/')[1]?.replace(/~1/g, '/').replace(/~0/g, '~') || '')).slice(0, 20)),
        'RESUMEN DE LAS SECCIONES (las rutas corresponden a las claves originales):',
        JSON.stringify(focusedWorld),
        'METADATOS EXACTOS DE ARRAYS EN LAS SECCIONES (path JSON Pointer, longitud real e índices realmente incluidos en el resumen): ' + JSON.stringify(collectArrayMetadata(selectedWorldDraft, selectedKeys)),
        mode === 'recommend'
          ? 'MODO RECOMENDACIÓN: solo puedes modificar propiedades que ya existen. No añadas propiedades nuevas ni posiciones nuevas a arrays. Las ideas que requieran ampliar el esquema deben ir en suggestions, no en changes.'
          : mode === 'repair'
            ? 'MODO REPARACIÓN: aplica el cambio mínimo para corregir el problema concreto. No alteres contenido no relacionado. Si no puedes demostrar una corrección segura, deja changes vacío y explica por qué en suggestions.'
            : 'MODO PETICIÓN: puedes proponer una propiedad nueva solo si la petición del usuario exige expresamente crearla y el padre existe. En arrays solo puedes reemplazar un índice existente o añadir exactamente al final; nunca saltar índices.'
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
      const rejectedChanges: string[] = []
      let ignoredTypeChanges = 0
      const changes = parsed.changes.map((item, index): ProposalChange | null => {
        const reject = (reason: string): null => {
          rejectedChanges.push(`Cambio ${index + 1}: ${reason}`)
          return null
        }
        if (!isRecord(item) || typeof item.path !== 'string' || !item.path.startsWith('/') ||
          typeof item.reason !== 'string' || !Object.prototype.hasOwnProperty.call(item, 'value')) {
          return reject('estructura no permitida; se esperaba un JSON Pointer y value como propiedad independiente.')
        }
        const rawSegments = item.path.slice(1).split('/')
        if (rawSegments.some((part) => /~(?![01])/g.test(part))) {
          return reject('JSON Pointer contiene un escape RFC 6901 inválido.')
        }
        const path = rawSegments.map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
        if (path.length === 0 || path.some((part) => !part || ['__proto__', 'prototype', 'constructor'].includes(part))) {
          return reject('JSON Pointer vacío o no permitido.')
        }
        const parent = readPath(selectedWorldDraft, path.slice(0, -1))
        if (!parent.exists || (!isRecord(parent.value) && !Array.isArray(parent.value))) {
          return reject(`ruta inexistente o no editable: ${path.join('.')}`)
        }
        const current = readPath(selectedWorldDraft, path)
        const leaf = path[path.length - 1]
        if (Array.isArray(parent.value) && (!/^\d+$/.test(leaf) || Number(leaf) > parent.value.length)) {
          return reject(`índice de array no permitido: ${path.join('.')}`)
        }
        if (mode === 'recommend' && !current.exists) {
          return reject(`recomendación descartada: no se permite inventar una propiedad o posición nueva (${path.join('.')}) sin una petición explícita`)
        }
        if (current.exists && getProposalValueKind(current.value) !== getProposalValueKind(item.value)) {
          ignoredTypeChanges += 1
          return null
        }
        return { path, value: item.value, previousValue: current.value, existed: current.exists,
          reason: item.reason, category: typeof item.category === 'string' ? item.category : 'modificación', remove: false }
      })
      const typedChanges = changes.filter((change): change is ProposalChange => change !== null)
      const effectiveChanges = typedChanges.filter((change) =>
        !change.existed || JSON.stringify(change.previousValue) !== JSON.stringify(change.value)
      )
      const ignoredNoOpChanges = typedChanges.length - effectiveChanges.length
      const pathKeys = effectiveChanges.map((change) => JSON.stringify(change.path))
      if (new Set(pathKeys).size !== pathKeys.length) throw new Error('La propuesta repite rutas.')
      setProposalChanges(effectiveChanges)
      setSelectedProposalPaths([])
      const ignoredMessages = [
        ignoredTypeChanges ? `${ignoredTypeChanges} cambio(s) descartado(s) por incompatibilidad de tipo` : '',
        ignoredNoOpChanges ? `${ignoredNoOpChanges} cambio(s) descartado(s) porque no modificaban el valor` : '',
        rejectedChanges.length ? `${rejectedChanges.length} cambio(s) descartado(s) por ruta o estructura inválida: ${rejectedChanges.slice(0, 4).join(' | ')}` : ''
      ].filter(Boolean)
      setProposalInfo(ignoredMessages.length ? 'Control automático: ' + ignoredMessages.join('; ') + '.' : '')
      const suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : []
      const usableSuggestions = suggestions.filter((item): item is Record<string, unknown> =>
        isRecord(item) && typeof item.title === 'string' && item.title.trim().length > 0 &&
        typeof item.detail === 'string' && item.detail.trim().length > 0
      ).slice(0, 8).map((item) => ({
        title: String(item.title).trim(), detail: String(item.detail).trim(),
        priority: typeof item.priority === 'string' ? item.priority : 'media'
      }))
      if (mode === 'recommend' && effectiveChanges.length === 0 && usableSuggestions.length === 0) {
        throw new Error('LM Studio no produjo ninguna recomendación utilizable: no hubo cambios seguros ni sugerencias con título y explicación.')
      }
      setProposalSuggestions(usableSuggestions)
      if (effectiveChanges.length === 0 && usableSuggestions.length === 0) {
        setProposalError('El modelo no encontró cambios seguros ni recomendaciones.')
      } else if (effectiveChanges.length === 0) {
        setProposalError('La IA generó recomendaciones, pero no encontró cambios que pueda representar de forma segura en el esquema actual.')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo generar la propuesta.'
      const failureSummary = [previousAttemptFailure, 'Intento ' + attempt + ': ' + message].filter(Boolean).join(' | ')
      if (mode === 'recommend' && attempt < 3) {
        setProposalInfo('No se obtuvo una recomendación utilizable en el intento ' + attempt + '/3. Reintentando automáticamente. Motivo: ' + message)
        await generateWorldProposal('recommend', undefined, attempt + 1, failureSummary)
        return
      }
      const exhausted = mode === 'recommend' && attempt >= 3
      const finalMessage = exhausted
        ? 'No fue posible generar recomendaciones utilizables tras 3 intentos. Informe de fallos: ' + failureSummary + '. Revisa la conexión y el modelo seleccionado en LM Studio; también puedes pedir una sección concreta mediante «Proponer cambios».'
        : message
      setProposalError(finalMessage)
      if (selectedWorldId) {
        await window.api.workspace.recordIssue({
          worldId: selectedWorldId, source: 'lm-studio', severity: 'warning',
          code: exhausted ? 'LOCAL_AI_RECOMMENDATION_EXHAUSTED' : 'LOCAL_AI_PROPOSAL_FAILURE',
          message: exhausted ? 'Recomendaciones agotadas tras 3 intentos. ' + finalMessage : message,
          path: ''
        }).catch(() => undefined)
        const issueResult = await window.api.workspace.listIssues(selectedWorldId)
        if (issueResult.success) setTrackedIssues(issueResult.issues)
      }
    } finally {
      if (attempt === 1) setProposalBusy(false)
    }
  }

  function toggleProposalChange(pathKey: string, checked: boolean): void {
    setSelectedProposalPaths((current) => checked
      ? [...new Set([...current, pathKey])]
      : current.filter((key) => key !== pathKey))
  }

  function discardProposalChange(pathKey: string): void {
    setProposalChanges((current) => current.filter((change) => JSON.stringify(change.path) !== pathKey))
    setSelectedProposalPaths((current) => current.filter((key) => key !== pathKey))
  }

  async function applyProposalToDraft(): Promise<void> {
    if (coverUploadBusy || itemImageUploadBusy) return
    const selectedChanges = proposalChanges.filter((change) => selectedProposalPaths.includes(JSON.stringify(change.path)))
    if (!selectedWorldDraft || selectedChanges.length === 0) {
      setProposalError('Selecciona al menos un cambio para aplicarlo al borrador local.')
      return
    }

    const staleChanges = selectedChanges.filter((change) => {
      const current = readPath(selectedWorldDraft, change.path)
      return current.exists !== change.existed ||
        (current.exists && JSON.stringify(current.value) !== JSON.stringify(change.previousValue))
    })
    if (staleChanges.length > 0) {
      setProposalError('Conflicto detectado: ' + staleChanges.map((change) => change.path.join(' › ')).join(', ') +
        '. El borrador cambió desde que se generó la propuesta. Descarta o vuelve a generar esos cambios antes de aplicarlos.')
      return
    }

    const overlappingPaths = selectedChanges.filter((change, index) =>
      selectedChanges.some((other, otherIndex) => {
        if (index === otherIndex) return false
        if (change.path.length === other.path.length) return false
        const shorterPath = change.path.length < other.path.length ? change.path : other.path
        return shorterPath.every((part, partIndex) => part === (change.path.length < other.path.length ? other.path : change.path)[partIndex])
      })
    )
    if (overlappingPaths.length > 0) {
      setProposalError('Conflicto de rutas: seleccionaste cambios sobre una propiedad y uno de sus descendientes. Aplica uno y vuelve a generar el otro.')
      return
    }

    try {
      await createDraftCheckpoint('before-proposal', 'Estado anterior a aplicar propuesta')
      let next = selectedWorldDraft
      for (const change of selectedChanges) next = change.remove ? removePath(next, change.path) : writePath(next, change.path, change.value)
      setSelectedWorldDraft(next)
      await createDraftCheckpoint('proposal-applied', 'Propuesta aplicada al borrador', next).catch((error) => setWorkspaceNotice(error instanceof Error ? error.message : 'No se pudo guardar el snapshot posterior a la propuesta.'))
      const indexResult = await window.api.workspace.buildIndex({ worldId: selectedWorldId, gameState: next })
      if (indexResult.success && indexResult.index) setWorldIndex(indexResult.index)
      setProposalChanges(proposalChanges.filter((change) => !selectedProposalPaths.includes(JSON.stringify(change.path))))
      setSelectedProposalPaths([])
      if (proposalIssueId) {
        await window.api.workspace.updateIssue({
          worldId: selectedWorldId, issueId: proposalIssueId, status: 'fixed-pending-validation',
          detail: 'Se aplicó una propuesta relacionada al borrador local. Pendiente de validación; no implica que el problema esté resuelto.'
        })
        const refreshedIssues = await window.api.workspace.listIssues(selectedWorldId)
        if (refreshedIssues.success) setTrackedIssues(refreshedIssues.issues)
        setProposalIssueId(null)
      }
      setWorldValidation(null)
      setWorldValidationError('')
      setProposalError('Propuesta aplicada únicamente al borrador local en memoria. El mundo remoto no fue modificado.')
    } catch (error) {
      setProposalError(error instanceof Error ? error.message : 'No se pudo aplicar la propuesta.')
    }
  }

  async function discardDraftChanges(): Promise<void> {
    if (coverUploadBusy || itemImageUploadBusy || !selectedWorldInitialGameState) return
    const restored = JSON.parse(JSON.stringify(selectedWorldInitialGameState)) as Record<string, unknown>
    try { await createDraftCheckpoint('before-restore', 'Copia anterior al reinicio') }
    catch (error) { setWorkspaceNotice(error instanceof Error ? error.message : 'No se pudo guardar el snapshot previo al reinicio.') }
    setSelectedWorldDraft(restored)
    try { await createDraftCheckpoint('draft-reset', 'Borrador restaurado a la versión descargada', restored) }
    catch (error) { setWorkspaceNotice(error instanceof Error ? error.message : 'No se pudo guardar el snapshot restaurado.') }
    if (selectedWorldId) {
      const indexResult = await window.api.workspace.buildIndex({ worldId: selectedWorldId, gameState: restored })
      if (indexResult.success && indexResult.index) setWorldIndex(indexResult.index)
    }
    setProposalChanges([])
    setSelectedProposalPaths([])
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
            <h1>VoyAgent</h1>
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
            <button className="secondary-button" onClick={() => void loadVoyageWorlds()} disabled={worldListBusy || coverUploadBusy || !voyageConfigured}>
              {worldListBusy ? 'Consultando mundos...' : 'Consultar mis mundos'}
            </button>
            {worldListOutput && <div className="world-list-inspector">
              <div className="helper">RESULTADO DE LA CONSULTA</div>
              <pre>{worldListOutput}</pre>
            </div>}

            <div className="world-create-panel voyage-account-tools">
              <div className="world-browser-heading"><strong>MODS Y LÍMITES DE USO</strong><span>CONSULTAS DE SOLO LECTURA</span></div>
              <p className="helper">La Creator API permite consultar los mods propios, guardados, pendientes y fuentes de remix. También permite consultar el uso de IA de Creator Studio. El contrato no expone operaciones para instalar, activar o eliminar mods desde esta aplicación.</p>
              <button className="secondary-button" onClick={() => void loadVoyageMods()} disabled={modsBusy || !voyageConfigured}>
                {modsBusy ? 'Consultando mods...' : 'Consultar mods disponibles'}
              </button>
              {modsOutput && <div className="world-list-inspector"><div className="helper">RESPUESTA ORIGINAL DE /mods</div><pre>{modsOutput}</pre></div>}
              <button className="secondary-button" onClick={() => void loadVoyageUsage()} disabled={usageBusy || !voyageConfigured}>
                {usageBusy ? 'Consultando límites...' : 'Consultar uso y límites de IA'}
              </button>
              {usageOutput && <div className="world-list-inspector"><div className="helper">RESPUESTA ORIGINAL DE /usage</div><pre>{usageOutput}</pre></div>}
              <p className="helper">Voyage no documenta todavía un esquema de respuesta detallado para estos dos endpoints en OpenAPI. Por eso se conserva y muestra el JSON recibido sin inventar campos ni interpretar cuotas.</p>
            </div>
            <div className="world-create-panel">
              <div className="world-browser-heading"><strong>CREAR MUNDO</strong><span>Nuevo espacio independiente</span></div>
              <label htmlFor="new-world-title">Título</label>
              <input id="new-world-title" value={newWorldTitle} onChange={(event) => setNewWorldTitle(event.target.value)} placeholder="Nombre del mundo" />
              <label htmlFor="new-world-description">Descripción (opcional)</label>
              <textarea id="new-world-description" value={newWorldDescription} onChange={(event) => setNewWorldDescription(event.target.value)} rows={2} placeholder="Descripción breve" />
              <label htmlFor="new-world-visibility">Visibilidad inicial</label>
              <select id="new-world-visibility" value={newWorldVisibility} onChange={(event) => setNewWorldVisibility(event.target.value as 'private' | 'unlisted')}>
                <option value="private">Privado</option>
                <option value="unlisted">No listado</option>
              </select>
              <label htmlFor="new-world-state">GameState inicial (JSON)</label>
              <textarea id="new-world-state" className="world-create-json" value={newWorldGameState} onChange={(event) => setNewWorldGameState(event.target.value)} rows={4} spellCheck={false} />
              <p className="helper">Se crea con el GameState indicado. Puedes comenzar con {'{}'} y completar el contenido después desde VoyAgent. La creación consume una operación de Creator API y no publica el mundo.</p>
              <button className="send-button" onClick={() => void createVoyageWorld()} disabled={worldMutationBusy || !voyageConfigured || !newWorldTitle.trim()}>
                {worldMutationBusy ? 'Procesando...' : 'Crear mundo en Voyage'}
              </button>
            </div>
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
                      <button
                        className="secondary-button"
                        onClick={() => void duplicateVoyageWorld(world)}
                        disabled={worldMutationBusy || !voyageConfigured}
                      >
                        {worldMutationBusy ? 'Procesando...' : 'Duplicar mundo'}
                      </button>
                    </div>
                  </article>
                ))}
                {selectedWorldId && (
                  <div className="world-detail-panel">
                    <div className="world-browser-heading">
                      <strong>{selectedWorldTitle}</strong>
                      <span>BORRADOR LOCAL · GUARDADO MANUAL</span>
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
                        {worldIndex && <p className="helper">Actualizado: {formatDate(worldIndex.generatedAt)} · Secciones raíz: {worldIndex.rootKeys.length} · Relaciones exactas: {worldIndex.relationshipCount}</p>}
                        {worldIndex && worldIndex.schemaDiagnostics.length > 0 && <div className="index-results">
                          <strong>Integridad estructural · {worldIndex.schemaDiagnostics.length} advertencia(s)</strong>
                          <p className="helper">Comprobaciones basadas en la estructura canónica documentada por Creator API Preview 1.3. Son diagnósticos locales; no modifican el GameState ni sustituyen la validación de Voyage.</p>
                          {worldIndex.schemaDiagnostics.map((diagnostic, index) => <article className="index-result" key={diagnostic.code + diagnostic.path + index}>
                            <strong>{diagnostic.code}</strong><code>{diagnostic.path}</code>
                            <span>Confianza de la regla: alta · Advertencia</span>
                            <p>{diagnostic.message}</p><p className="helper">Evidencia: {diagnostic.evidence}</p>
                          </article>)}
                        </div>}
                        {worldIndex && worldIndex.schemaDiagnostics.length === 0 && <div className="index-results">
                          <strong>Integridad estructural local: sin advertencias</strong>
                          <p className="helper">El índice no detectó problemas en las reglas estructurales locales comprobadas. Esto no equivale a una validación completa del esquema de Voyage.</p>
                          {trackedIssues.filter((issue) => issue.source === 'voyage-validation' && issue.status !== 'resolved' && issue.status !== 'false-positive').length > 0 && <p className="helper">Voyage mantiene {trackedIssues.filter((issue) => issue.source === 'voyage-validation' && issue.status !== 'resolved' && issue.status !== 'false-positive').length} incidencia(s) de validación oficial abierta(s). Consulta el registro de problemas y ejecuta una nueva validación después de corregirlas.</p>}
                        </div>}
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
                            <button className="secondary-button" onClick={() => void showNodeRelations(item.path)}>Ver relaciones</button>
                          </article>)}
                        </div>}
                        {relatedResults.length > 0 && <div className="index-results">
                          <strong>Relaciones encontradas · {relatedResults.length}</strong>
                          <p className="helper">Coincidencias exactas de nombres entre valores de texto y objetos/arrays. No se consideran referencias confirmadas por el esquema.</p>
                          {relatedResults.map((item, index) => <article className="index-result" key={item.node.path + item.direction + index}>
                            <strong>{item.direction === 'outgoing' ? 'Referencia hacia' : 'Referenciado desde'}: {item.node.key}</strong>
                            <code>{item.node.path}</code><span>Coincidencia: {item.relationship.matchedValue}</span><p>{item.node.preview}</p>
                          </article>)}
                        </div>}

                        <div className="world-browser-heading issue-heading">
                          <strong>HISTORIAL LOCAL DE BORRADORES</strong>
                          <span>{draftSnapshots.length} SNAPSHOTS</span>
                        </div>
                        <p className="helper">Copias locales del GameState, separadas del servidor. Se conservan hasta 20 snapshots y 80 MiB por mundo; los duplicados exactos no se repiten. Cada copia se verifica mediante SHA-256 antes de restaurarla.</p>
                        <button className="secondary-button" onClick={() => void createDraftCheckpoint('manual-checkpoint', 'Checkpoint manual del usuario').then(() => setWorkspaceNotice('Checkpoint local guardado. No se modificó Voyage.')).catch((error) => setWorkspaceNotice(error instanceof Error ? error.message : 'No se pudo guardar el checkpoint.'))} disabled={!selectedWorldDraft || snapshotBusy}>
                          Guardar snapshot del borrador actual
                        </button>
                        {draftSnapshots.length === 0 ? <p className="helper">Todavía no hay snapshots locales.</p> :
                          draftSnapshots.map((snapshot) => <article className="index-result" key={snapshot.id}>
                            <strong>{snapshot.label || snapshot.source}</strong>
                            <span>{formatDate(snapshot.createdAt)} · {snapshot.source} · {(snapshot.bytes / 1024).toFixed(1)} KiB</span>
                            <code>{snapshot.id}</code>
                            <div className="issue-actions">
                              <button className="secondary-button" onClick={() => void inspectDraftSnapshot(snapshot.id)} disabled={snapshotBusy}>Comparar / inspeccionar</button>
                              <button className="secondary-button" onClick={() => void restoreDraftSnapshot(snapshot.id)} disabled={snapshotBusy || !selectedWorldDraft}>Restaurar</button>
                            </div>
                          </article>)}
                        {snapshotPreview && selectedWorldDraft && <div className="proposal-diff">
                          <strong>Comparación: snapshot seleccionado frente al borrador actual</strong>
                          <span className="helper">{snapshotPreview.summary.label || snapshotPreview.summary.source} · {formatDate(snapshotPreview.summary.createdAt)}</span>
                          {snapshotComparison.map((entry, index) => <div className="proposal-diff-row" key={entry.path + index}>
                            <code>{entry.path}</code><span className="proposal-diff-before">{entry.before}</span><span className="proposal-diff-after">{entry.after}</span>
                          </div>)}
                          {snapshotComparison.length === 0 && <p className="helper">El snapshot y el borrador actual no presentan diferencias detectables.</p>}
                          <button className="secondary-button" onClick={() => setSnapshotPreview(null)}>Cerrar comparación</button>
                        </div>}
                        <div className="world-browser-heading issue-heading">
                          <strong>HISTORIAL REMOTO DE VOYAGE</strong>
                          <span>{remoteRevisions.length} REVISIONES</span>
                        </div>
                        <p className="helper">Revisiones guardadas por Voyage Creator Studio. Descargar o importar solo afecta al borrador local. La restauración remota crea una nueva revisión activa en Voyage, conserva los metadatos y no publica el mundo; requiere confirmación independiente.</p>
                        <button className="secondary-button" onClick={() => void loadRemoteRevisions()} disabled={remoteRevisionBusy || !selectedWorldId}>
                          {remoteRevisionBusy ? 'Consultando...' : 'Consultar revisiones remotas'}
                        </button>
                        {remoteRevisions.length === 0 ? <p className="helper">Todavía no se ha consultado el historial remoto o no hay revisiones disponibles.</p> :
                          remoteRevisions.map((revision) => <article className="index-result" key={revision.id}>
                            <strong>Revisión guardada · {formatDate(revision.createdAt)}</strong>
                            <code>{revision.id}</code>
                            <div className="issue-actions">
                              <button className="secondary-button" onClick={() => void inspectRemoteRevision(revision)} disabled={remoteRevisionBusy}>Descargar / comparar</button>
                            </div>
                          </article>)}
                        {remoteRevisionPreview && selectedWorldDraft && <div className="proposal-diff">
                          <strong>Comparación: revisión remota frente al borrador local</strong>
                          <span className="helper">{remoteRevisionPreview.id} · {formatDate(remoteRevisionPreview.createdAt)}</span>
                          {remoteRevisionComparison.map((entry, index) => <div className="proposal-diff-row" key={entry.path + index}>
                            <code>{entry.path}</code><span className="proposal-diff-before">{entry.before}</span><span className="proposal-diff-after">{entry.after}</span>
                          </div>)}
                          {remoteRevisionComparison.length === 0 && <p className="helper">La revisión y el borrador local no presentan diferencias detectables.</p>}
                          <div className="issue-actions">
                            <button className="secondary-button" onClick={() => void copyRemoteRevisionToLocalDraft()} disabled={remoteRevisionBusy}>Importar al borrador local</button>
                            <button className="danger-button" onClick={() => void restoreRemoteRevisionInVoyage()} disabled={remoteRevisionBusy}>Restaurar en Voyage (remoto)</button>
                            <button className="secondary-button" onClick={() => setRemoteRevisionPreview(null)}>Cerrar comparación</button>
                          </div>
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
                            {selectedWorldDraft && issue.status !== 'resolved' && issue.status !== 'false-positive' && <button className="secondary-button" onClick={() => { void changeIssueStatus(issue.id, 'investigating'); void generateWorldProposal('repair', issue) }} disabled={proposalBusy || !selectedModel || worldReadBusy}>Proponer reparación dirigida</button>}
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
                            <p className="helper">Si no obtiene ninguna idea utilizable, VoyAgent reintentará automáticamente hasta 2 veces más. Si los 3 intentos fallan, guardará un informe con los motivos.</p>
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
                            {proposalIssueId && <p className="helper">Esta propuesta está vinculada a un problema concreto. Al aplicar cambios, el problema pasará a «reparación pendiente de validación»; no se marcará como resuelto automáticamente.</p>}
                            {proposalChanges.length > 0 && (
                              <div className="proposal-review">
                                <strong>Revisión de propuesta · {proposalChanges.length} cambios</strong>
                                <label className="proposal-select-all"><input type="checkbox" checked={selectedProposalPaths.length === proposalChanges.length && proposalChanges.length > 0} onChange={(event) => setSelectedProposalPaths(event.target.checked ? proposalChanges.map((change) => JSON.stringify(change.path)) : [])} /> Seleccionar todos los cambios</label>
                                {proposalChanges.map((change) => (
                                  <div className="proposal-change" key={JSON.stringify(change.path)}>
                                    <label className="proposal-change-select"><input type="checkbox" checked={selectedProposalPaths.includes(JSON.stringify(change.path))} onChange={(event) => toggleProposalChange(JSON.stringify(change.path), event.target.checked)} /> Incluir este cambio</label>
                                    <div className="proposal-change-heading">
                                      <strong>{change.path.join(' › ')}</strong>
                                      <button className="proposal-reject-button" type="button" onClick={() => discardProposalChange(JSON.stringify(change.path))}>Rechazar</button>
                                    </div>
                                    <span className="helper">{change.category}</span>
                                    <span className={`proposal-risk ${assessProposalRisk(change).level}`}>Riesgo estimado: {assessProposalRisk(change).level.toUpperCase()}</span>
                                    <p className="helper">{assessProposalRisk(change).reason}</p>
                                    <p>{change.reason}</p>
                                    <div className="proposal-diff">
                                      <strong>Diferencias detectadas</strong>
                                      {buildProposalDiff(change.existed ? change.previousValue : '[propiedad nueva]', change.value).map((entry, index) => (
                                        <div className="proposal-diff-row" key={entry.path + index}>
                                          <code>{entry.path}</code>
                                          <span className="proposal-diff-before">{entry.before}</span>
                                          <span className="proposal-diff-after">{entry.after}</span>
                                        </div>
                                      ))}
                                    </div>
                                    <span className="helper">Valor actual{change.existed ? '' : ' (propiedad nueva)'}</span>
                                    <pre>{change.existed ? JSON.stringify(change.previousValue, null, 2) : '— No existe actualmente —'}</pre>
                                    <span className="helper">Valor propuesto</span>
                                    <pre>{change.remove ? '— Eliminar esta propiedad —' : JSON.stringify(change.value, null, 2)}</pre>
                                  </div>
                                ))}
                                <button className="secondary-button" onClick={() => void applyProposalToDraft()} disabled={selectedProposalPaths.length === 0}>Aplicar cambios seleccionados ({selectedProposalPaths.length}) al borrador local</button>
                                <button className="secondary-button" onClick={() => { setProposalChanges([]); setSelectedProposalPaths([]); setProposalSuggestions([]) }}>Descartar propuesta</button>
                              </div>
                            )}
                            <button className="secondary-button" onClick={discardDraftChanges} disabled={proposalBusy || worldValidationBusy}>Descartar todos los cambios del borrador</button>
                            <p className="helper">Los cambios todavía no se guardan en Voyage. Al cerrar o cambiar de mundo, el borrador en memoria se pierde.</p>
                          </div>
                        )}


                        <div className="proposal-editor cover-upload-editor">
                          <div className="world-browser-heading">
                            <strong>PORTADA DEL MUNDO</strong>
                            <span>SUBIDA DIRECTA + MODERACIÓN</span>
                          </div>
                          <p className="helper">Selecciona una imagen PNG, JPG o WebP de hasta 5 MiB. VoyAgent comprueba el archivo y sus dimensiones localmente, solicita una autorización temporal, transfiere los bytes y pide moderación a Voyage. La portada moderada se asigna al documento local; el guardado remoto sigue siendo una acción independiente.</p>
                          {moderatedCoverUrl && <img className="moderated-cover-preview" src={moderatedCoverUrl} alt="Vista previa de la portada moderada" />}
                          <button className="secondary-button" onClick={() => void uploadSelectedWorldCover()} disabled={coverUploadBusy || worldReadBusy || worldValidationBusy || !selectedWorldDocument || !voyageConfigured}>
                            {coverUploadBusy ? 'Subiendo y moderando...' : 'Seleccionar y moderar portada'}
                          </button>
                          <p className="helper">Límite documentado: 5 MiB. WORLD_COVER admite cualquier dimensión positiva. La moderación no modifica ni publica el mundo.</p>
                        </div>
                        <div className="proposal-editor item-image-upload-editor">
                          <div className="world-browser-heading">
                            <strong>IMÁGENES DE OBJETOS</strong>
                            <span>ITEM_IMAGE + MODERACIÓN</span>
                          </div>
                          <p className="helper">Sube una imagen para una definición existente en initialGameState.itemTypes. El contrato documenta el destino ITEM_IMAGE y la ruta itemTypes[itemKey].imageUrl. Requiere PNG, JPG o WebP, mínimo 600 × 600 píxeles y máximo 5 MiB.</p>
                          <label htmlFor="item-image-key">Objeto de itemTypes</label>
                          <select
                            id="item-image-key"
                            value={selectedItemImageKey}
                            onChange={(event) => setSelectedItemImageKey(event.target.value)}
                            disabled={itemImageUploadBusy || !selectedWorldDraft || !isRecord(selectedWorldDraft.itemTypes)}
                          >
                            <option value="">Selecciona un objeto...</option>
                            {selectedWorldDraft && isRecord(selectedWorldDraft.itemTypes) &&
                              Object.keys(selectedWorldDraft.itemTypes).map((key) => (
                                <option key={key} value={key}>{key}</option>
                              ))}
                          </select>
                          {(() => {
                            const item = selectedWorldDraft && isRecord(selectedWorldDraft.itemTypes) && selectedItemImageKey
                              ? selectedWorldDraft.itemTypes[selectedItemImageKey]
                              : null
                            const imageUrl = isRecord(item) && typeof item.imageUrl === 'string' ? item.imageUrl : ''
                            return imageUrl
                              ? <img className="moderated-cover-preview" src={imageUrl} alt={'Imagen actual de ' + selectedItemImageKey} />
                              : <p className="helper">El objeto seleccionado no tiene imageUrl asignada.</p>
                          })()}
                          <button className="secondary-button" onClick={() => void uploadSelectedItemImage()} disabled={
                            itemImageUploadBusy || coverUploadBusy || worldReadBusy || worldValidationBusy ||
                            !selectedWorldDraft || !selectedItemImageKey || !isRecord(selectedWorldDraft.itemTypes) ||
                            !isRecord(selectedWorldDraft.itemTypes[selectedItemImageKey]) || !voyageConfigured
                          }>
                            {itemImageUploadBusy ? 'Subiendo y moderando...' : 'Seleccionar y moderar imagen del objeto'}
                          </button>
                          <p className="helper">La URL moderada se asigna al borrador local. Debes ejecutar la validación y el guardado normal para persistirla; no se publica el mundo.</p>
                        </div>
                        <div className="proposal-editor key-order-editor">
                          <div className="world-browser-heading">
                            <strong>ORDEN DE CLAVES JSON</strong>
                            <span>CAMBIO REMOTO</span>
                          </div>
                          <p className="helper">Reordena propiedades de un objeto del GameState sin reemplazar sus valores. La ruta empieza dentro de initialGameState. Introduce las claves que deben aparecer primero, una por línea; las omitidas conservan su orden relativo y quedan al final. Los arrays no se pueden reordenar con esta operación.</p>
                          <label htmlFor="order-object-path">Ruta del objeto (array JSON)</label>
                          <input id="order-object-path" value={orderPathInput} onChange={(event) => setOrderPathInput(event.target.value)} placeholder='["npcs","Guide"]' disabled={orderBusy} />
                          <label htmlFor="order-object-keys">Claves que deben aparecer primero (una por línea)</label>
                          <textarea id="order-object-keys" rows={5} value={orderKeysInput} onChange={(event) => setOrderKeysInput(event.target.value)} placeholder={'Guide\nMerchant\nBlacksmith'} disabled={orderBusy} />
                          {(() => {
                            try {
                              const pathValue = JSON.parse(orderPathInput)
                              if (!Array.isArray(pathValue) || pathValue.some((part) => typeof part !== 'string')) return <p className="helper">Introduce una ruta JSON válida.</p>
                              const target = selectedWorldDraft ? readPath(selectedWorldDraft, pathValue) : { exists: false, value: undefined }
                              if (!target.exists || !isRecord(target.value)) return <p className="helper">La ruta no apunta a un objeto disponible en el borrador.</p>
                              const targetObject = target.value
                              return <p className="helper">Claves actuales ({Object.keys(targetObject).length}): {Object.keys(targetObject).slice(0, 24).join(' · ')}{Object.keys(targetObject).length > 24 ? ' · …' : ''}</p>
                            } catch {
                              return <p className="helper">La ruta debe ser un array JSON, por ejemplo ["npcs","Guide"].</p>
                            }
                          })()}
                          {selectedWorldDraft && selectedWorldInitialGameState && JSON.stringify(selectedWorldDraft) !== JSON.stringify(selectedWorldInitialGameState) &&
                            <p className="helper security-warning">Hay cambios locales pendientes. Debes guardarlos o descartarlos antes de usar el reordenamiento remoto.</p>}
                          <button className="secondary-button" onClick={() => void reorderSelectedWorldObject()} disabled={orderBusy || worldReadBusy || worldValidationBusy || Boolean(moderatedCoverUrl) || !selectedWorldDraft || JSON.stringify(selectedWorldDraft) !== JSON.stringify(selectedWorldInitialGameState)}>
                            {orderBusy ? 'Reordenando en Voyage...' : 'Reordenar claves en Voyage'}
                          </button>
                          <p className="helper">Antes de la operación se guarda un checkpoint local. VoyAgent descarga un ETag nuevo, usa If-Match y vuelve a leer el documento. Si la respuesta queda incierta, invalida el ETag local para impedir reintentos con estado obsoleto.</p>
                        </div>
                        <button className="secondary-button save-world-button" onClick={() => void saveSelectedWorld()} disabled={worldValidationBusy || worldReadBusy || coverUploadBusy || itemImageUploadBusy || !selectedWorldDraft || !selectedWorldEtag || !worldValidation?.valid}>
                          Guardar borrador remoto (requiere validación correcta)
                        </button>
                        <p className="helper">El guardado reemplaza el borrador de Creator Studio usando If-Match con el ETag descargado. Exige validación correcta y confirmación explícita. No publica el mundo.</p>
                        <button className="secondary-button" onClick={() => void validateSelectedWorld()} disabled={worldValidationBusy || worldReadBusy || coverUploadBusy || itemImageUploadBusy || !selectedWorldDraft}>
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
        <span>VoyAgent</span>
        <span>Motor local · Sin uso de la IA interna de Voyage</span>
      </footer>
    </main>
  )
}

export default App