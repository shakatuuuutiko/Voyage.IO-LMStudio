# Phase 2 — Local World Workspace

## Scope implemented

This phase adds a persistent local workspace for each Voyage world, while keeping the Voyage GameState as the remote source of truth.

### Main-canvas HUD

- The selected world's detail/work area is moved from the narrow navigation rail into a fixed, scrollable main-canvas surface.
- The left rail remains for model configuration, Voyage credentials, integrations, and world selection.
- The selected-world canvas now contains the world inspector, local knowledge index, proposal editor, and validation panel.
- Proposed changes can be selected individually. Applying a subset retains the unselected proposals for later review.
- The selected-world canvas is only shown after a world is opened.

### World Knowledge Index

Storage location: Electron `app.getPath('userData')/world-workspaces/<shortId>/world-index.json`.

The index is generated locally from the complete downloaded `initialGameState`. It stores:
- Exact JSON Pointer paths, with RFC 6901 escaping for `~` and `/`.
- Key names, JSON value kinds, short previews, child counts, and searchable terms.
- Root keys, generation timestamp, node count, schema version, and a completeness flag.

The index is a derived cache, not a replacement for the Voyage GameState. It is rebuilt when a world is opened, and refreshed after applying or discarding local draft changes. A hard cap of 150,000 indexed nodes prevents unbounded indexing; the UI marks capped indexes as partial.

Search is currently structural/textual substring matching over indexed key names, paths, and previews. It does not yet use embeddings or semantic vector search. Proposal generation now queries this index using terms derived from the task and supplies matching paths/previews as retrieval hints to the section-selection and proposal prompts. The model still receives bounded summaries of selected draft sections; index retrieval does not yet fetch arbitrary full-size subtrees. Index results point back to the original GameState paths; the search result is not itself an editable source of truth.

### Issue and repair tracker

Storage location: Electron `app.getPath('userData')/world-workspaces/<shortId>/issues.json`.

The tracker stores:
- Stable issue ID, world ID, source, severity, code, message, and path.
- Status, first/last seen timestamps, occurrence count, and append-only status/detection history.
- Repeated exact detections increment the existing issue. A recurrence reopens an issue that had been marked fixed, resolved, or false-positive.

Currently captured automatically:
- Voyage draft validation errors and warnings.
- Local LM Studio proposal failures.
- Voyage validation request failures.

Users can also manually report warnings, phantom failures, and observed in-game behavior. Each issue exposes its recent detection/status history in the HUD. After a complete Voyage draft validation, previously tracked validation issues absent from the new result are marked resolved. This reconciliation applies only to Voyage validation issues; manual reports and LM Studio failures are not auto-resolved.

### Safety boundaries

- Index creation and issue tracking are local operations.
- No GameState write, Voyage PUT, publication, or unpublication is performed by this phase.
- Applying proposal changes only updates the in-memory local draft; the index is then refreshed from that draft.
- Reopening a world downloads the remote GameState and rebuilds the index from it, replacing any draft-derived index.
- The tracker does not have access to private Voyage runtime/Game Master logs. It can capture Creator API validation results, local application/LM Studio failures, and user-reported observations only.

## Next engineering steps

1. Add a context retrieval service that takes an intent and relevant index hits, then fetches the exact source fragments from the current draft before constructing the LM Studio prompt.
2. Extend per-change review with explicit reject controls, conflict detection, and structured diff review.
3. Add stronger semantic checks and reference integrity checks for proposed changes.
4. Add repair verification that compares the issue set before and after validation and preserves evidence.
5. Implement remote save separately, with ETag/If-Match concurrency protection and explicit confirmation. Publication remains a separate, explicit action.

## Verification status

Changes were reviewed statically in the GitHub feature branch. They have not yet been run through local TypeScript typecheck, Electron startup, or LM Studio/Voyage integration tests. Those checks must be run on the Windows development machine.
