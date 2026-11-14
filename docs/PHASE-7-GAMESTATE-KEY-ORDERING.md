# Phase 7 — GameState JSON key ordering

## Contract verified

The Creator API Preview 1.3 OpenAPI contract documents:

- `PATCH /worlds/{shortId}/order`
- Required `If-Match` header.
- JSON body with exactly `path` and `keys`.
- `path` is an array of 1–100 string segments inside `initialGameState`.
- `keys` are unique strings naming existing properties to place first.
- Omitted keys retain their relative order and follow the listed keys.
- Arrays are not reorder targets.
- Integer-index object keys must remain in ascending numeric order.
- HTTP 412 indicates a revision conflict.

The operation changes property order only; it does not send replacement values.

## Implementation

- Added `VoyageCreatorClient.reorderWorldObjectKeys`.
- The client downloads the current world immediately before mutation and uses its fresh ETag in `If-Match`.
- The client verifies that the path resolves to an existing object, rejects arrays/scalars and unknown or duplicate keys, and checks the numeric-key ordering rule for supplied integer-index keys.
- The client sends the documented PATCH body and re-reads the world after a successful response.
- IPC and preload expose the operation without exposing the API key.
- The UI accepts a JSON path and a newline-separated priority key list, previews current keys, and asks for confirmation.
- To avoid silently overwriting or misrepresenting local edits, the UI blocks remote ordering while the local GameState differs from the initially downloaded GameState.
- A local checkpoint is created before mutation. After confirmed mutation, the UI refreshes the document, ETag, index and local snapshot.
- If the mutation result or post-mutation read is uncertain, the local ETag is invalidated and the user must reopen the world before another remote mutation.
- No automatic retry, publication, or full-document replacement is performed.

## Manual verification

1. Pull the feature branch and run `npm run typecheck` and `npm run build`.
2. Open a test world with a non-empty object such as `npcs`.
3. Enter path `["npcs"]` and put two existing NPC keys in the desired order, one per line.
4. Confirm the operation. Verify in the reloaded JSON that the selected keys appear first and all values remain unchanged.
5. Repeat with a nested object path, for example `["npcs","Guide"]`.
6. Verify that a path to an array, a missing path, duplicate keys, and unknown keys are rejected before the API mutation.
7. Make a local draft edit and verify the remote reorder button is disabled until the local edit is saved or discarded.
8. If another Creator Studio client changes the world concurrently, verify that a 412 conflict requires reopening the world; do not retry against the stale ETag.

These checks are pending user execution. No remote world was modified during implementation.
