# Phase 4 — Local relationship graph (initial implementation)

Branch: `feature/voyage-creator-api`

## Scope

This increment extends the per-world local index with a conservative relationship graph. It is a retrieval aid, not a schema validator and not proof that two game entities are semantically linked.

### Graph construction

- The index schema is now version 2. A world opened through the normal workflow is re-indexed from the freshly downloaded GameState.
- During iterative indexing, string values are considered possible references only when they are short, single-line values and are not HTTP(S) URLs.
- A possible reference becomes an edge only when its normalized value exactly matches the key of exactly one object or array node in the same indexed GameState.
- Matching uses Unicode NFKC normalization and case-insensitive comparison.
- Ambiguous matches, fuzzy matches, partial phrases, and inferred relationships based only on similar words are omitted.
- Self-links and ancestor/descendant links are excluded.
- Edge count is capped at 20,000; the existing node cap remains 150,000. If node traversal is truncated, graph inference is suppressed entirely because global name uniqueness cannot be established.
- Edges retain source and target JSON Pointer paths and the matched text.

### Retrieval and UI

- The local inspector can show incoming and outgoing exact-name relationships for a search result.
- Proposal context retrieval performs one batched graph lookup for its highest-ranked lexical matches, then reads related fragments from the current in-memory draft using their exact indexed paths.
- The LM prompt is explicitly told that these edges are hints, not confirmed semantic relationships.
- IPC returns compact index metadata only; it does not send the complete node or edge arrays to the renderer.
- The graph is stored locally alongside the per-world index. It is never sent to Voyage.

### Known limitations

This first graph pass does not yet understand Creator Studio schema-specific foreign keys, IDs, nested reference conventions, or relation cardinality. It may miss valid links that use IDs rather than display names. It can also produce a false positive when an ordinary text value exactly equals a unique object/array key. The UI labels these as inferred exact-name matches.

The graph must not be used to auto-edit or delete data. Before implementing schema-aware validation, inspect representative real GameState structures and document each supported reference pattern.

## Manual verification

After pulling the branch on Windows:

```powershell
npm run typecheck
npm run build
npm run dev
```

Then open a world and verify:
1. The local index reports a relationship count.
2. Searching for a known entity and selecting **Ver relaciones** shows only exact-name matches.
3. A result with no known links displays no relationship list.
4. Generate a recommendation and confirm graph-related fragments appear as additional context without creating automatic edits.
5. Existing API key, issue history, and local world data remain available.

No local typecheck, build, Electron runtime, or live Voyage test has been executed by the assistant. No remote GameState write or publication is part of this increment.

## Next steps

1. Inspect representative GameState fields to identify authoritative ID/reference patterns.
2. Add schema-aware edge types only where evidence supports them.
3. Add cross-reference diagnostics with confidence and evidence, initially as warnings only.
4. Add before/after structured diffs and change-risk labels.
5. Link tracked issues to proposed changes and post-repair validation evidence.
6. Implement remote save separately using ETag/If-Match and explicit confirmation; keep publication independent.
