# Phase 3 — Proposal safety and VoyAgent branding

Branch: `feature/voyage-creator-api`

## Implemented in this phase

### Safer recommendation mode

- Recommendation mode may only change properties that already exist in the current GameState.
- New object properties and new array positions are rejected in recommendation mode. Ideas requiring schema expansion remain in the textual suggestions list.
- User-directed request mode may create an object property only when its parent exists; array writes may replace an existing index or append exactly at the end, never skip indices.
- JSON Pointer escape sequences are checked against RFC 6901 before decoding.
- Exact array metadata (path, real length, and indices shown in the model summary) is included in the proposal prompt.
- Invalid paths are rejected individually, preserving other valid proposals.
- Incompatible JSON value kinds and no-op changes are filtered.

### Proposal review and conflict detection

- Each proposal can be explicitly rejected without discarding the remaining proposals.
- Before applying selected changes, the renderer checks that the current draft value still matches the value captured when the proposal was generated.
- Selected parent/child path overlaps are rejected to avoid order-dependent overwrites.
- Changes still apply only to the in-memory draft. No remote save or publication was added.

### Product name

- Visible application name changed to **VoyAgent**.
- Packaged product name, Windows executable, and installer artifact names use VoyAgent.
- The Electron application ID remains `com.voyage.aicompanion`.
- The internal npm package name remains `voyage-io` to avoid changing the development profile and lockfile identity.
- A startup migration moves an existing legacy user-data directory to the new product-name directory when needed. It preserves the encrypted Voyage API key, per-world indexes, and issue history.

## Verification still required

The changes have been committed to the feature branch but have not been run on the user's Windows machine. Required checks:

```powershell
git pull origin feature/voyage-creator-api
npm run typecheck
npm run build
npm run dev
```

After startup, verify that the Voyage key remains configured and that previously indexed worlds and issue history still appear.

## Next implementation priorities

1. Add structured before/after diffs and explicit change-risk labels.
2. Add stronger cross-reference checks between factions, skills, resources, locations, items, and progression.
3. Improve retrieval with a relationship graph over the local index; retain exact source-path reads as the authority.
4. Improve repair verification by associating issue IDs with proposed changes and post-repair validation evidence.
5. Add remote save as a separate, explicitly confirmed operation using the fetched ETag with `If-Match`. Handle HTTP 412 as a stale-draft conflict. Publishing remains separate and manually confirmed.
