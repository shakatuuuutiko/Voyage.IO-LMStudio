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


## Proposal review increment — structured diffs and risk heuristics

The proposal review panel now supplements the full before/after JSON values with a compact recursive diff:

- Compares object properties and array positions recursively, up to four nesting levels.
- Displays at most 12 changed leaves per proposal to keep the review panel bounded.
- Shows removed/added properties and array-length changes explicitly.
- Truncates long scalar previews; the full values remain available in the existing before/after blocks.

Each proposal also receives a heuristic risk label:

- **High:** paths containing sensitive gameplay/configuration terms, or changes replacing object/array structures.
- **Medium:** numeric scalar changes.
- **Low:** other scalar text/boolean changes.

These labels are review hints, not a schema validator, semantic classifier, or guarantee of safety. A low-risk label never bypasses the existing type, path, stale-value, overlap, selection, and Voyage validation checks. A proposal is never applied automatically, and all changes remain local to the in-memory draft.

### Verification status

The GitHub branch contains the implementation and styles. The assistant has not run the Windows TypeScript check, package build, or Electron runtime. Run npm run typecheck after pulling the latest branch before proceeding to the next implementation increment.


## Remote draft save — conditional replacement

The client now exposes an explicit save action for the live Creator Studio draft:

- Sends PUT to /worlds/{shortId} with the complete preserved world envelope and If-Match set to the ETag obtained from the last read.
- The renderer retains the downloaded world document and replaces only its initialGameState with the reviewed local draft.
- Saving is disabled until the current draft has a successful Voyage validation and a usable ETag.
- The user must click the save control and accept a confirmation dialog. The dialog states that this replaces the remote draft.
- After a successful PUT, the app reads the world again to refresh the document and ETag. If the follow-up read fails, the UI reports that the write was accepted but requires reopening the world before another save.
- HTTP revision conflicts are surfaced as errors; the app does not retry blindly. The user must reopen the latest world, reconcile changes, validate again, and then save.
- Publishing and unpublishing remain separate operations and are not invoked by this feature.

The save handler preserves unknown top-level world fields by spreading the downloaded document and changing only initialGameState. The Creator API contract is sourced from the repository's Creator API OpenAPI document and agent guide.

### Remote-write safety boundary

The assistant has only added the capability to the application. No PUT request has been sent and no Voyage world has been modified by this implementation work. Runtime behavior, the server's ETag response after PUT, and conflict handling still require verification against a test world.


## Issue-linked targeted repairs

Each open or investigating tracked issue can now launch a dedicated repair proposal:

- The issue's code, severity, message, source, occurrence count, and exact JSON Pointer path are passed as task context.
- When the path exists in the current in-memory draft, its current value is retrieved directly and added to the model context.
- The root section containing that path is prioritized even if the model's section selector omits it.
- The prompt asks for the smallest justified correction and explicitly discourages unrelated edits.
- Starting a repair moves the issue to **investigating**. Applying selected changes moves it to **fixed-pending-validation**, not resolved.
- A subsequent Voyage validation can resolve a matching Voyage-origin issue when it no longer appears. User-reported or application issues remain pending for manual verification because a schema validation cannot prove an in-game behavior is fixed.

The proposal remains subject to the existing path, type, stale-value, overlap, selection, and validation safeguards. No repair is applied automatically, and nothing is sent to Voyage until the separate remote-save action is explicitly confirmed.

### Verification status

The issue-linked repair implementation is committed on the feature branch. It has not yet been checked with the user's local TypeScript compiler or Electron runtime.


## Local draft history and recovery

Each world workspace now keeps GameState snapshots under its local Electron user-data directory, separate from the Voyage API and remote world document.

- A baseline snapshot is created when a world is opened.
- The app records checkpoints around proposal application, draft reset, restoration, and a confirmed remote save. The user can also create a manual checkpoint.
- Snapshots contain only the GameState object, not API keys or the surrounding world metadata.
- Each snapshot stores a SHA-256 digest. The app verifies the digest before exposing its GameState for comparison or restoration.
- Retention is bounded to 20 snapshots and 80 MiB per world; an individual snapshot is limited to 25 MiB. Exact duplicate GameStates reuse the existing snapshot entry.
- The UI can compare a selected snapshot against the current in-memory draft and restore it after explicit confirmation.
- Before restoring, the current draft is checkpointed automatically. Restore rebuilds the local index and clears stale proposals and validation results.
- Snapshot creation and restoration are local-only. Neither action calls the Voyage API or publishes a world. Remote saving remains a separate, validated, explicitly confirmed operation.

The history is stored in `world-workspaces/<shortId>/draft-history.json` and `draft-snapshots/`. Removing application data or the relevant workspace directory removes this local history. The current increment does not provide cloud backup or cross-device synchronization.

### Manual verification

After pulling the branch:

1. Run `npm run typecheck` and `npm run build`.
2. Open a world and confirm that an initial snapshot appears.
3. Create a manual checkpoint; confirm that reopening the same unchanged GameState does not create a duplicate.
4. Apply a proposal and confirm that before/after snapshots are listed.
5. Compare an older snapshot with the current draft and inspect the displayed paths and values.
6. Restore a snapshot; confirm that the current draft changes, the index refreshes, validation/proposals clear, and the UI explicitly states that Voyage was not modified.
7. Confirm that the remote-save button remains a separate action and still requires validation and confirmation.


## Automatic retries for local recommendations

The **Recommend** action now performs up to three total attempts when it cannot produce a usable result. A usable result contains at least one validated change or at least one non-empty suggestion with both a title and an explanation. Invalid JSON, failed section selection, LM Studio request errors/timeouts, truncated output, and proposals with no usable ideas trigger another attempt. Retry prompts include the preceding failure reason and ask the model to explore different concrete ideas.

The app does not retry after a usable recommendation is produced, even when no safe direct edit exists but explanatory suggestions do. After the third failed attempt, it stops, displays a final diagnostic, and records a `LOCAL_AI_RECOMMENDATION_EXHAUSTED` warning in the per-world issue tracker with the reasons from all three attempts. Other modes (explicit user requests and repairs) retain their existing single-attempt behavior. No retry applies changes automatically.
