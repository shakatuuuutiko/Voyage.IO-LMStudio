# Phase 0 — Baseline audit

Date: 2026-11-13
Branch: `feature/voyage-creator-api`
Base: `main` at `23690294e1c0d9ead35a4080604fc3b258f55a45`

## Scope and safety

- This branch was created from the initial `main` commit. The user subsequently uploaded the official API contract files to `main`; exact copies are now included in this feature branch under `docs/creator-api/`.
- Keep implementation work on this feature branch. Do not merge or publish changes without explicit approval.
- Preserve the existing Electron + React + TypeScript application and the working LM Studio IPC contract while extending it.
- Voyage API credentials are accepted transiently through the password input and one IPC call, but are never persisted in renderer state/localStorage, returned to the UI, logged, sent to LM Studio, or committed. The main process stores only the encrypted value.
- Publish/unpublish must remain explicit user-initiated actions with a confirmation step.

## Repository baseline

The repository is a small Electron application using Electron 44, electron-vite 6, React 19, and TypeScript 5.9. The package scripts provide typechecking and a production build:

- `npm run typecheck`
- `npm run build`
- `npm run build:win`

There is currently no test script and no test framework declared in `package.json`. The repository tree contains no GitHub Actions workflow. These commands have **not** been run in this remote audit; a local Windows build is still required.

The existing LM Studio integration is implemented directly in `src/main/index.ts` and exposed through `src/preload/index.ts`. It currently provides:

- `lmstudio:list-models` → GET `/v1/models`
- `lmstudio:chat` → POST `/v1/chat/completions`
- A hardcoded endpoint at `http://127.0.0.1:1234`
- Non-streaming chat responses

The renderer consumes these methods through `window.api.lmStudio`. Preserve these channel names and method signatures during the first refactor unless a compatibility migration is explicitly planned.

## Findings to address

1. **LM Studio configuration:** the base URL is hardcoded. Move it into validated main-process configuration, retaining `http://127.0.0.1:1234` as the default.
2. **Electron isolation:** `BrowserWindow` sets `sandbox: false` and does not explicitly declare `contextIsolation` or `nodeIntegration`. Review and harden these settings alongside preload compatibility; do not change them blindly without testing the app.
3. **Voyage API key storage:** no Voyage authentication or secure storage exists yet. Use Electron `safeStorage` from the main process and store only encrypted data in the app's user-data directory.
4. **Application identity:** `electron-builder.yml` uses `appId: com.electron.app`, while the main process sets `com.voyage.aicompanion`. Align these before packaging.
5. **Packaging metadata:** author, homepage, and generic update URL still contain template values. Do not configure a real update feed until a release/update strategy is chosen.
6. **Preload typing:** `src/preload/index.d.ts` names the bridge `VoyageAPI` although it currently exposes only LM Studio. Consider a neutral `AppAPI` name when extending it, while preserving renderer compatibility.

## Official Creator API contract captured

The user uploaded both official artifacts to the repository's `main` branch. They were read and copied byte-for-byte into this feature branch:

- [OpenAPI contract](creator-api/openapi.json) — source blob SHA `412bc6af1ab275d1d2383c12573e58f20e08d390`
- [Agent guide](creator-api/agent-guide.md) — source blob SHA `0b09555c29a50c284d87c69416d45d9476511b03`

The OpenAPI document identifies itself as version `1.3.0-preview`, OpenAPI `3.1.0`. Its server URL is relative (`/creator/v1`); production base URL is `https://api.aidungeon.com/creator/v1`. Use one selected environment consistently. Alpha/Beta may upgrade a shared world draft beyond production compatibility. Never switch environments or alter version fields automatically.

### Contract endpoints found

- Worlds: `GET/POST /worlds`, `GET/PUT /worlds/{shortId}`, `POST /worlds/{shortId}/duplicate`.
- Ordering: `PATCH /worlds/{shortId}/order` with `If-Match`, for object-key order only (not arrays).
- Validation: `POST /validate`, with `draft` or stricter `publish` stage.
- Revisions: list, download, and `POST .../restore`.
- Publication: `POST /worlds/{shortId}/publish` and `/unpublish`.
- Moderation: `GET/POST /worlds/{shortId}/moderation`.
- Metadata: `GET /mods`, `GET /usage`.
- Image upload: `POST /uploads`, signed-URL byte upload, moderation, and deletion of unmoderated/rejected uploads.
- Music upload: `POST /uploads/music`, signed-URL byte upload, then `POST /uploads/music/{uploadId}/finalize`.
- Generated images: area, location, NPC portrait, and region-map endpoints.

The contract explicitly excludes Creator Studio chat, conversations, agent runs, cancellation, undo, and server-pushed events. Therefore this app's local LM Studio model must act as an external planning/editor assistant; it cannot drive the internal Studio agent through this API.

### Authentication discrepancy to resolve

The earlier human-readable overview refers to Creator API keys. The newly uploaded `agent-guide.md` specifically says **Player API keys**, requires the `sk-voyage-v1-` format, a required scope, an active account, and Creator Studio plus Creator API rollout access (unless the account is a developer). Treat the uploaded guide and selected-host OpenAPI contract as the implementation source of truth, but verify the exact key creation UI/permissions with the user before building onboarding copy. Do not assume an API key can be created by the app.

### Critical data and mutation rules

- A world response is an envelope containing `data.world` (per guide) and its ETag; preserve the full `shortId` and `initialGameState`. The OpenAPI schemas define the editable world fields.
- Canonical `initialGameState` ownership is root-level shared fields plus party-owned data under `parties[partyId]`. Preserve all party records. Do not flatten or normalize unknown authored content.
- Save a local checkpoint before changes; validate; replace the complete world with current `If-Match`; read back and verify.
- Every side-effecting POST requires a unique `Idempotency-Key`. Reuse a key only for an exact retry of the same request.
- A stale `If-Match` returns 412; re-read and reconcile. Never blindly retry a full replacement.
- `request_in_progress` means the idempotency key remains protected; respect `Retry-After`.
- `request_status_unknown` means the mutation may have happened. Reconcile the observable world/Studio state before any new mutation.
- Clean pre-side-effect failures such as `studio_unavailable` release the idempotency claim; honor the documented retry guidance.
- The JSON request limit is 64 MiB. Account limits are 480 total requests/minute, 120 mutation requests/minute, and 20 costly requests/minute.
- The API's OpenAPI `x-media-constraints` defines image upload MIME types, 5 MiB maximum, and per-target dimensions. Do not hardcode stale image rules separately.
- AI image generation requires a paid Voyage plan. Custom direct image upload remains a separate flow.
- Custom music uploads have their own file types, size and quota rules, and require finalization. Music generation is not exposed.
- Publishing may trigger cover-review/moderation requirements. The app must validate and present the outcome, then require explicit user confirmation before publication.

## Verification status

| Check | Status |
|---|---|
| Feature branch created from initial `main` | Passed |
| Repository tree and key source/config files reviewed | Passed |
| Official Creator API overview and agent specification reviewed | Passed |
| Uploaded OpenAPI contract copied into feature branch | Passed |
| Uploaded agent guide copied into feature branch | Passed |
| Contract version and endpoint inventory parsed | Passed |
| `npm run typecheck` | Not run — requires local project environment |
| `npm run build` | Not run — requires local project environment |
| Windows packaging build | Not run |

## Phase 1 implementation status

A first connection foundation is now present on this branch:

- `src/main/services/voyage/client.ts`: production-host HTTP client and authenticated connection check via `GET /worlds?page=0&type=world`; no `Origin` header is sent.
- `src/main/services/voyage/secure-store.ts`: encrypted key storage using Electron `safeStorage`; rejects unavailable or `basic_text` storage backends.
- `src/main/ipc/voyage-handlers.ts`: status, save, test and clear handlers. The key is never returned through IPC.
- `src/preload/index.ts` and `src/preload/index.d.ts`: typed bridge additions. Existing LM Studio methods are preserved.
- `src/renderer/src/App.tsx`: password input, save/test/clear controls, and status feedback. The input is uncontrolled and cleared after successful save.
- `src/main/index.ts`: explicitly declares `contextIsolation: true` and `nodeIntegration: false`; sandbox remains disabled pending a separate compatibility test.

The UI validates only the documented key prefix and token presence. Only the authenticated API request can establish whether the key is active, correctly scoped, and eligible.

## Verification status update

- Source edits are committed to the feature branch.
- The local environment used for this remote session cannot resolve GitHub, so the repository could not be cloned here for a build.
- `npm run typecheck`, `npm run build`, a Windows launch test, and a live authenticated API test remain unverified and must be run from the user's Windows checkout.

## Next step

Run the project locally and verify the Voyage key status/save/test/clear flow. Once a successful authenticated response is observed, capture the real `GET /worlds` and `GET /worlds/{shortId}` payload shapes and ETag behavior. Those responses are intentionally not fully modeled in OpenAPI; do not implement world browsing or editing based on guessed response shapes.
