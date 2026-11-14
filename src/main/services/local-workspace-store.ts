import { app } from 'electron'
import { mkdir, readFile, rename, unlink, writeFile } from 'fs/promises'
import { createHash, randomUUID } from 'crypto'
import { join } from 'path'

export interface WorldIndexNode {
  path: string
  key: string
  kind: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'
  preview: string
  terms: string
  childCount: number
}

export interface WorldRelationship {
  sourcePath: string
  targetPath: string
  matchedValue: string
  kind: 'exact-name-reference'
}

export interface WorldSchemaDiagnostic {
  code: string
  severity: 'warning'
  path: string
  message: string
  evidence: string
  confidence: 'high'
}

export interface WorldIndex {
  schemaVersion: 3
  worldId: string
  generatedAt: string
  nodeCount: number
  complete: boolean
  rootKeys: string[]
  nodes: WorldIndexNode[]
  relationships: WorldRelationship[]
  relationshipCount: number
  schemaDiagnostics: WorldSchemaDiagnostic[]
}

export interface TrackedIssue {
  id: string
  worldId: string
  source: 'voyage-validation' | 'lm-studio' | 'application' | 'user'
  severity: 'error' | 'warning' | 'notice'
  code: string
  message: string
  path: string
  status: 'open' | 'investigating' | 'fixed-pending-validation' | 'resolved' | 'false-positive'
  firstSeenAt: string
  lastSeenAt: string
  occurrences: number
  history: Array<{ at: string; action: string; detail: string }>
}

function safeWorldId(worldId: string): string {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(worldId)) throw new Error('Identificador de mundo no válido.')
  return worldId
}

async function workspaceDir(worldId: string): Promise<string> {
  const directory = join(app.getPath('userData'), 'world-workspaces', safeWorldId(worldId))
  await mkdir(directory, { recursive: true })
  return directory
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback
    throw new Error('No se pudo leer el almacenamiento local: ' + (error instanceof Error ? error.message : 'error desconocido'))
  }
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  const temporary = path + '.' + randomUUID() + '.tmp'
  await writeFile(temporary, JSON.stringify(value, null, 2), 'utf8')
  await rename(temporary, path)
}

function kindOf(value: unknown): WorldIndexNode['kind'] {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'object') return 'object'
  return typeof value as 'string' | 'number' | 'boolean'
}

function previewOf(value: unknown): string {
  if (typeof value === 'string') return value.slice(0, 240)
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `Array con ${value.length} elementos`
  if (typeof value === 'object') return `Objeto con ${Object.keys(value as object).length} propiedades`
  return String(value)
}

function normalizeReference(value: string): string {
  return value.trim().normalize('NFKC').toLocaleLowerCase()
}

export async function buildWorldIndex(worldId: string, gameState: Record<string, unknown>): Promise<WorldIndex> {
  const nodes: WorldIndexNode[] = []
  const rawReferences: Array<{ sourcePath: string; targetName: string }> = []
  const stack: Array<{ value: unknown; path: string; key: string }> = [{ value: gameState, path: '', key: '$' }]
  const maxNodes = 150000

  while (stack.length > 0 && nodes.length < maxNodes) {
    const current = stack.pop()!
    const value = current.value
    const kind = kindOf(value)
    const children = value !== null && typeof value === 'object' ? Object.entries(value) : []
    const terms = [current.key, current.path, previewOf(value)].join(' ').toLocaleLowerCase()

    nodes.push({
      path: current.path,
      key: current.key,
      kind,
      preview: previewOf(value),
      terms: terms.slice(0, 1200),
      childCount: children.length
    })

    if (typeof value === 'string') {
      const candidate = value.trim()
      if (
        candidate.length >= 2 &&
        candidate.length <= 120 &&
        !/[\r\n]/.test(candidate) &&
        !/^https?:\/\//i.test(candidate)
      ) {
        rawReferences.push({ sourcePath: current.path, targetName: normalizeReference(candidate) })
      }
    }

    for (let index = children.length - 1; index >= 0; index -= 1) {
      const [key, child] = children[index]
      const escaped = key.replace(/~/g, '~0').replace(/\//g, '~1')
      stack.push({ value: child, path: current.path + '/' + escaped, key })
    }
  }

  const complete = stack.length === 0
  const relationships: WorldRelationship[] = []

  // A truncated index cannot establish global name uniqueness, so infer no edges.
  if (complete) {
    const targetsByName = new Map<string, string[]>()

    for (const node of nodes) {
      if ((node.kind !== 'object' && node.kind !== 'array') || !node.key || node.key === '$') continue
      const name = normalizeReference(node.key)
      if (name.length < 2) continue
      const paths = targetsByName.get(name) || []
      paths.push(node.path)
      targetsByName.set(name, paths)
    }

    const seenEdges = new Set<string>()
    for (const reference of rawReferences) {
      const targets = targetsByName.get(reference.targetName)
      if (!targets || targets.length !== 1 || targets[0] === reference.sourcePath) continue

      const targetPath = targets[0]
      if (reference.sourcePath.startsWith(targetPath + '/') || targetPath.startsWith(reference.sourcePath + '/')) continue

      const edgeKey = reference.sourcePath + '->' + targetPath
      if (seenEdges.has(edgeKey)) continue
      seenEdges.add(edgeKey)

      relationships.push({
        sourcePath: reference.sourcePath,
        targetPath,
        matchedValue: reference.targetName,
        kind: 'exact-name-reference'
      })
      if (relationships.length >= 20000) break
    }
  }

  const schemaDiagnostics: WorldSchemaDiagnostic[] = []
  const parties = gameState.parties
  if (Object.prototype.hasOwnProperty.call(gameState, 'parties')) {
    if (!parties || typeof parties !== 'object' || Array.isArray(parties)) {
      schemaDiagnostics.push({
        code: 'PARTIES_CONTAINER_INVALID', severity: 'warning', path: '/parties',
        message: 'La guía de Creator API define parties como el contenedor de estado por partyId; se esperaba un objeto indexado por identificador.',
        evidence: 'initialGameState.parties existe, pero no es un objeto.',
        confidence: 'high'
      })
    } else {
      for (const [partyId, partyState] of Object.entries(parties as Record<string, unknown>)) {
        if (!partyState || typeof partyState !== 'object' || Array.isArray(partyState)) {
          const escapedPartyId = partyId.replace(/~/g, '~0').replace(/\//g, '~1')
          schemaDiagnostics.push({
            code: 'PARTY_STATE_INVALID', severity: 'warning', path: '/parties/' + escapedPartyId,
            message: 'El estado de cada grupo debe estar contenido en parties[partyId]; este registro no tiene una estructura de objeto.',
            evidence: 'El valor del registro partyId es ' + kindOf(partyState) + '.',
            confidence: 'high'
          })
        }
      }
    }
  }

  for (const key of ['quests', 'arcs', 'narrativeEvents']) {
    if (Object.prototype.hasOwnProperty.call(gameState, key)) {
      schemaDiagnostics.push({
        code: 'PARTY_OWNED_DATA_AT_ROOT', severity: 'warning', path: '/' + key,
        message: 'La guía de Creator API Preview 1.3 sitúa ' + key + ' dentro de parties[partyId], no en la raíz compartida del GameState. Comprueba si este contenido pertenece realmente a un grupo.',
        evidence: 'Se encontró initialGameState.' + key + ' en la raíz.',
        confidence: 'high'
      })
    }
  }

  const index: WorldIndex = {
    schemaVersion: 3,
    worldId: safeWorldId(worldId),
    generatedAt: new Date().toISOString(),
    nodeCount: nodes.length,
    complete,
    rootKeys: Object.keys(gameState),
    nodes,
    relationships,
    relationshipCount: relationships.length,
    schemaDiagnostics
  }

  const directory = await workspaceDir(worldId)
  await atomicWrite(join(directory, 'world-index.json'), index)
  return index
}

export async function readWorldIndex(worldId: string): Promise<WorldIndex | null> {
  const directory = await workspaceDir(worldId)
  const index = await readJson<WorldIndex | null>(join(directory, 'world-index.json'), null)
  return index?.schemaVersion === 3 && Array.isArray(index.relationships) && Array.isArray(index.schemaDiagnostics) ? index : null
}

export async function searchWorldIndex(worldId: string, query: string, limit = 60): Promise<WorldIndexNode[]> {
  const index = await readWorldIndex(worldId)
  if (!index) return []

  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return []

  return index.nodes
    .map((node) => ({
      node,
      score: terms.reduce((score, term) => score + (node.terms.includes(term) ? 1 : 0), 0)
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.node.path.localeCompare(b.node.path))
    .slice(0, Math.max(1, Math.min(200, limit)))
    .map((item) => item.node)
}

export async function getRelatedWorldNodes(
  worldId: string,
  paths: string[],
  limit = 40
): Promise<Array<{ matchedPath: string; direction: 'outgoing' | 'incoming'; node: WorldIndexNode; relationship: WorldRelationship }>> {
  const index = await readWorldIndex(worldId)
  if (!index) return []

  const requestedPaths = new Set(paths.filter((path) => typeof path === 'string'))
  const nodeByPath = new Map<string, WorldIndexNode>(index.nodes.map((node) => [node.path, node] as const))
  const results: Array<{
    matchedPath: string
    direction: 'outgoing' | 'incoming'
    node: WorldIndexNode
    relationship: WorldRelationship
  }> = []

  for (const relationship of index.relationships) {
    if (requestedPaths.has(relationship.sourcePath)) {
      const node = nodeByPath.get(relationship.targetPath)
      if (node) results.push({ matchedPath: relationship.sourcePath, direction: 'outgoing', node, relationship })
    }
    if (requestedPaths.has(relationship.targetPath)) {
      const node = nodeByPath.get(relationship.sourcePath)
      if (node) results.push({ matchedPath: relationship.targetPath, direction: 'incoming', node, relationship })
    }
    if (results.length >= Math.max(1, Math.min(200, limit))) break
  }

  return results
}

export async function listTrackedIssues(worldId: string): Promise<TrackedIssue[]> {
  const directory = await workspaceDir(worldId)
  return readJson<TrackedIssue[]>(join(directory, 'issues.json'), [])
}

export async function recordTrackedIssue(input: {
  worldId: string
  source: TrackedIssue['source']
  severity: TrackedIssue['severity']
  code: string
  message: string
  path?: string
}): Promise<TrackedIssue> {
  const directory = await workspaceDir(input.worldId)
  const file = join(directory, 'issues.json')
  const issues = await readJson<TrackedIssue[]>(file, [])
  const now = new Date().toISOString()
  const path = input.path || ''
  const fingerprint = (issue: TrackedIssue): boolean =>
    issue.source === input.source &&
    issue.severity === input.severity &&
    issue.code === input.code &&
    issue.path === path &&
    issue.message === input.message

  let issue = issues.find(fingerprint)
  if (issue) {
    issue.lastSeenAt = now
    issue.severity = input.severity
    issue.occurrences += 1
    if (issue.status !== 'open' && issue.status !== 'investigating') issue.status = 'open'
    issue.history.push({ at: now, action: 'detected-again', detail: 'El mismo problema volvió a detectarse.' })
  } else {
    issue = {
      id: randomUUID(),
      worldId: safeWorldId(input.worldId),
      source: input.source,
      severity: input.severity,
      code: input.code,
      message: input.message,
      path,
      status: 'open',
      firstSeenAt: now,
      lastSeenAt: now,
      occurrences: 1,
      history: [{ at: now, action: 'detected', detail: 'Problema registrado por primera vez.' }]
    }
    issues.unshift(issue)
  }

  await atomicWrite(file, issues)
  return issue
}

export async function updateTrackedIssue(
  worldId: string,
  issueId: string,
  status: TrackedIssue['status'],
  detail = ''
): Promise<TrackedIssue[]> {
  const directory = await workspaceDir(worldId)
  const file = join(directory, 'issues.json')
  const issues = await readJson<TrackedIssue[]>(file, [])
  const issue = issues.find((item) => item.id === issueId)
  if (!issue) throw new Error('No se encontró el problema seleccionado.')

  const now = new Date().toISOString()
  issue.status = status
  issue.lastSeenAt = now
  issue.history.push({ at: now, action: 'status-changed', detail: detail || `Estado cambiado a ${status}.` })
  await atomicWrite(file, issues)
  return issues
}


export interface DraftSnapshotSummary {
  id: string
  worldId: string
  createdAt: string
  source: 'world-opened' | 'manual-checkpoint' | 'before-proposal' | 'proposal-applied' | 'draft-reset' | 'before-restore' | 'remote-saved'
  label: string
  bytes: number
  sha256: string
}

interface DraftSnapshotManifest {
  schemaVersion: 1
  worldId: string
  snapshots: DraftSnapshotSummary[]
}

const MAX_DRAFT_SNAPSHOTS = 20
const MAX_DRAFT_SNAPSHOT_BYTES = 25 * 1024 * 1024
const MAX_DRAFT_HISTORY_BYTES = 80 * 1024 * 1024

function snapshotSource(value: unknown): DraftSnapshotSummary['source'] {
  const allowed: DraftSnapshotSummary['source'][] = [
    'world-opened', 'manual-checkpoint', 'before-proposal', 'proposal-applied',
    'draft-reset', 'before-restore', 'remote-saved'
  ]
  if (typeof value !== 'string' || !allowed.includes(value as DraftSnapshotSummary['source'])) {
    throw new Error('Origen de snapshot no válido.')
  }
  return value as DraftSnapshotSummary['source']
}

async function readSnapshotManifest(worldId: string): Promise<DraftSnapshotManifest> {
  const directory = await workspaceDir(worldId)
  const manifest = await readJson<DraftSnapshotManifest>(
    join(directory, 'draft-history.json'),
    { schemaVersion: 1, worldId: safeWorldId(worldId), snapshots: [] }
  )
  if (manifest.schemaVersion !== 1 || manifest.worldId !== worldId || !Array.isArray(manifest.snapshots)) {
    throw new Error('El historial local de borradores tiene un formato no válido.')
  }
  return manifest
}

export async function listDraftSnapshots(worldId: string): Promise<DraftSnapshotSummary[]> {
  const manifest = await readSnapshotManifest(worldId)
  return [...manifest.snapshots].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function readDraftSnapshot(worldId: string, snapshotId: string): Promise<{
  summary: DraftSnapshotSummary
  gameState: Record<string, unknown>
}> {
  if (!/^[a-f0-9-]{36}$/i.test(snapshotId)) throw new Error('Identificador de snapshot no válido.')
  const manifest = await readSnapshotManifest(worldId)
  const summary = manifest.snapshots.find((item) => item.id === snapshotId)
  if (!summary) throw new Error('No se encontró el snapshot solicitado.')
  const directory = await workspaceDir(worldId)
  const gameState = await readJson<Record<string, unknown> | null>(
    join(directory, 'draft-snapshots', snapshotId + '.json'),
    null
  )
  if (!gameState || typeof gameState !== 'object' || Array.isArray(gameState)) {
    throw new Error('El contenido del snapshot no existe o está dañado.')
  }
  const serialized = JSON.stringify(gameState)
  const digest = createHash('sha256').update(serialized).digest('hex')
  if (digest !== summary.sha256) throw new Error('La integridad del snapshot no coincide; no se restaurará.')
  return { summary, gameState }
}

export async function createDraftSnapshot(input: {
  worldId: string
  gameState: Record<string, unknown>
  source: DraftSnapshotSummary['source']
  label?: string
}): Promise<DraftSnapshotSummary> {
  const worldId = safeWorldId(input.worldId)
  if (!input.gameState || typeof input.gameState !== 'object' || Array.isArray(input.gameState)) {
    throw new Error('El snapshot requiere un GameState de tipo objeto.')
  }
  const source = snapshotSource(input.source)
  const serialized = JSON.stringify(input.gameState)
  const bytes = Buffer.byteLength(serialized, 'utf8')
  if (bytes > MAX_DRAFT_SNAPSHOT_BYTES) {
    throw new Error('El borrador supera el límite local de 25 MiB para un snapshot. No se guardó.')
  }
  const sha256 = createHash('sha256').update(serialized).digest('hex')
  const manifest = await readSnapshotManifest(worldId)
  const duplicate = manifest.snapshots.find((item) => item.sha256 === sha256)
  if (duplicate) return duplicate

  const directory = await workspaceDir(worldId)
  const snapshotDirectory = join(directory, 'draft-snapshots')
  await mkdir(snapshotDirectory, { recursive: true })
  const summary: DraftSnapshotSummary = {
    id: randomUUID(),
    worldId,
    createdAt: new Date().toISOString(),
    source,
    label: typeof input.label === 'string' ? input.label.slice(0, 120) : '',
    bytes,
    sha256
  }
  await atomicWrite(join(snapshotDirectory, summary.id + '.json'), input.gameState)
  manifest.snapshots.push(summary)
  manifest.snapshots.sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  let totalBytes = manifest.snapshots.reduce((total, item) => total + item.bytes, 0)
  while (manifest.snapshots.length > MAX_DRAFT_SNAPSHOTS || totalBytes > MAX_DRAFT_HISTORY_BYTES) {
    const removed = manifest.snapshots.pop()
    if (!removed) break
    totalBytes -= removed.bytes
    try { await unlink(join(snapshotDirectory, removed.id + '.json')) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  await atomicWrite(join(directory, 'draft-history.json'), manifest)
  return summary
}
