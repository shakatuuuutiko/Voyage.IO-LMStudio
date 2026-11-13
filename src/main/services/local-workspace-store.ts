import { app } from 'electron'
import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import { randomUUID } from 'crypto'
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

export interface WorldIndex {
  schemaVersion: 2
  worldId: string
  generatedAt: string
  nodeCount: number
  complete: boolean
  rootKeys: string[]
  nodes: WorldIndexNode[]
  relationships: WorldRelationship[]
  relationshipCount: number
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

  while (stack.length && nodes.length < maxNodes) {
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
      if (candidate.length >= 2 && candidate.length <= 120 && !/[\r\n]/.test(candidate) && !/^https?:\/\//i.test(candidate)) {
        rawReferences.push({ sourcePath: current.path, targetName: normalizeReference(candidate) })
      }
    }
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const [key, child] = children[index]
      const escaped = key.replace(/~/g, '~0').replace(/\//g, '~1')
      stack.push({ value: child, path: current.path + '/' + escaped, key })
    }
  }

  // Infer only unambiguous exact-name links from string values to named object/array entries.
  // No fuzzy matching: uncertain references are deliberately omitted.
  const relationships: WorldRelationship[] = []
  // A partial index cannot establish that a target name is globally unique.
  // Suppress graph inference entirely when the node cap truncated traversal.
  if (stack.length === 0) {
    const targetsByName = new Map<string, string[]>()
    for (const node of nodes) {
      if ((node.kind !== 'object' && node.kind !== 'array') || !node.key || node.key === '

  const index: WorldIndex = {
    schemaVersion: 2,
    worldId: safeWorldId(worldId),
    generatedAt: new Date().toISOString(),
    nodeCount: nodes.length,
    complete: stack.length === 0,
    rootKeys: Object.keys(gameState),
    nodes,
    relationships,
    relationshipCount: relationships.length
  }
  const directory = await workspaceDir(worldId)
  await atomicWrite(join(directory, 'world-index.json'), index)
  return index
}

export async function readWorldIndex(worldId: string): Promise<WorldIndex | null> {
  const directory = await workspaceDir(worldId)
  const index = await readJson<WorldIndex | null>(join(directory, 'world-index.json'), null)
  return index?.schemaVersion === 2 && Array.isArray(index.relationships) ? index : null
}

export async function searchWorldIndex(worldId: string, query: string, limit = 60): Promise<WorldIndexNode[]> {
  const index = await readWorldIndex(worldId)
  if (!index) return []
  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return []
  return index.nodes
    .map((node) => ({ node, score: terms.reduce((score, term) => score + (node.terms.includes(term) ? 1 : 0), 0) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.node.path.localeCompare(b.node.path))
    .slice(0, Math.max(1, Math.min(200, limit)))
    .map((item) => item.node)
}

export async function getRelatedWorldNodes(worldId: string, paths: string[], limit = 40): Promise<Array<{ matchedPath: string; direction: 'outgoing' | 'incoming'; node: WorldIndexNode; relationship: WorldRelationship }>> {
  const index = await readWorldIndex(worldId)
  if (!index) return []
  const requestedPaths = new Set(paths.filter((path) => typeof path === 'string'))
  const nodeByPath = new Map<string, WorldIndexNode>(index.nodes.map((node) => [node.path, node] as const))
  const results: Array<{ matchedPath: string; direction: 'outgoing' | 'incoming'; node: WorldIndexNode; relationship: WorldRelationship }> = []
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
    issue.source === input.source && issue.severity === input.severity && issue.code === input.code && issue.path === path && issue.message === input.message
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
) continue
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

  const index: WorldIndex = {
    schemaVersion: 2,
    worldId: safeWorldId(worldId),
    generatedAt: new Date().toISOString(),
    nodeCount: nodes.length,
    complete: stack.length === 0,
    rootKeys: Object.keys(gameState),
    nodes,
    relationships,
    relationshipCount: relationships.length
  }
  const directory = await workspaceDir(worldId)
  await atomicWrite(join(directory, 'world-index.json'), index)
  return index
}

export async function readWorldIndex(worldId: string): Promise<WorldIndex | null> {
  const directory = await workspaceDir(worldId)
  const index = await readJson<WorldIndex | null>(join(directory, 'world-index.json'), null)
  return index?.schemaVersion === 2 && Array.isArray(index.relationships) ? index : null
}

export async function searchWorldIndex(worldId: string, query: string, limit = 60): Promise<WorldIndexNode[]> {
  const index = await readWorldIndex(worldId)
  if (!index) return []
  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return []
  return index.nodes
    .map((node) => ({ node, score: terms.reduce((score, term) => score + (node.terms.includes(term) ? 1 : 0), 0) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.node.path.localeCompare(b.node.path))
    .slice(0, Math.max(1, Math.min(200, limit)))
    .map((item) => item.node)
}

export async function getRelatedWorldNodes(worldId: string, paths: string[], limit = 40): Promise<Array<{ matchedPath: string; direction: 'outgoing' | 'incoming'; node: WorldIndexNode; relationship: WorldRelationship }>> {
  const index = await readWorldIndex(worldId)
  if (!index) return []
  const requestedPaths = new Set(paths.filter((path) => typeof path === 'string'))
  const nodeByPath = new Map(index.nodes.map((node) => [node.path, node]))
  const results: Array<{ matchedPath: string; direction: 'outgoing' | 'incoming'; node: WorldIndexNode; relationship: WorldRelationship }> = []
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
    issue.source === input.source && issue.severity === input.severity && issue.code === input.code && issue.path === path && issue.message === input.message
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
