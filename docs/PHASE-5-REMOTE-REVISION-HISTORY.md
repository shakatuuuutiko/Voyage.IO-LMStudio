# Phase 5 — Remote revision history

VoyAgent now integrates the read-only revision endpoints documented by Voyage Creator API:

- `GET /worlds/{shortId}/revisions` lists immutable saved draft revisions.
- `GET /worlds/{shortId}/revisions/{revisionId}` downloads a historical draft in the current GameState schema.

The application parses the opaque revision ID and creation timestamp, and validates that a downloaded revision contains the selected world's `shortId` and an object-valued `initialGameState`. It does not infer compatibility from the list: a revision download can still fail with Voyage's documented version-mismatch response.

## Renderer workflow

1. Open a world as usual.
2. Select **Consultar revisiones remotas** to request the remote history on demand.
3. Select **Descargar / comparar** for a revision. The downloaded GameState is held in renderer memory and compared against the current local draft.
4. Select **Importar al borrador local** only after reviewing the comparison. The app checkpoints the current local draft, replaces only the in-memory GameState, rebuilds the local index, and clears stale proposals and validation results.

## Mutation boundary

This phase does not call the remote restore endpoint, replace the live Voyage draft, or publish the world. Importing a remote revision is a local draft operation only. The user must run Voyage validation and use the separate conditional-save workflow to change the live draft.

Remote restore remains a future, separately gated operation. Its contract requires a fresh `ETag`, an `If-Match` header, and a unique `Idempotency-Key`; it creates a new live head revision and is not equivalent to local import. It must never be silently triggered by previewing or importing a revision.

## Verification

The implementation is committed on `feature/voyage-creator-api`. Run the local typecheck/build and test the workflow against a world with at least one saved revision. This repository change has not been executed in the user's Windows environment by the assistant.
