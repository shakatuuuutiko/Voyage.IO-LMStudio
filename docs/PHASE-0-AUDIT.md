# Phase 0 — Baseline audit

Date: 2026-11-13
Branch: `feature/voyage-creator-api`
Base: `main` at `23690294e1c0d9ead35a4080604fc3b258f55a45`

## Scope and safety

- This branch was created from `main`; no existing source files were changed during the initial audit.
- Keep all implementation work on this feature branch. Do not merge or publish changes without explicit approval.
- Preserve the existing Electron + React + TypeScript application and the working LM Studio IPC contract while extending it.
- Voyage API credentials must remain in Electron's main process and must never enter renderer state, prompts, logs, or source control.
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

## Official Creator API contract facts verified from Voyage documentation

Documentation reviewed:

- https://voyage.io/studio/api-docs
- https://voyage.io/studio/api-docs/agent-specification

The production base URL is `https://api.aidungeon.com/creator/v1`; endpoint paths are relative to `/creator/v1`. The production host must be used consistently unless the creator explicitly chooses an experimental environment.

Authentication uses `Authorization: Bearer sk-voyage-v1-...`. Keys are created in Creator Studio under Settings → API keys and are shown only once.

The documented safe world-edit workflow is:

1. List owned worlds with `GET /worlds`.
2. Download the live draft with `GET /worlds/{shortId}` and retain its ETag.
3. Keep a local checkpoint.
4. Edit the complete world document, preserving `shortId` and `initialGameState`.
5. Validate with `POST /validate`.
6. Replace the complete world document with `PUT /worlds/{shortId}` and the current `If-Match` value.
7. Read the world again and verify the intended changes.

Important documented safeguards:

- A stale ETag returns HTTP 412; re-read and reconcile rather than blindly retrying a full replacement.
- Side-effecting POST requests require a unique `Idempotency-Key`.
- `request_in_progress` and `request_status_unknown` require reconciliation; never issue a new mutation blindly after an unknown outcome.
- The JSON request limit is 64 MiB.
- Documented account limits: 480 total requests/minute, 120 mutation requests/minute, and 20 costly requests/minute.
- Creator API does not expose Creator Studio chat, Studio agent conversations, agent runs, cancellation, undo, or server-pushed event subscriptions.
- Publishing and unpublishing endpoints exist, but this application will gate them behind explicit user confirmation.

## Contract artifact still required before implementation

Voyage's official agent specification explicitly instructs integrators to retrieve `GET /openapi.json` and `GET /agent-guide.md` from the production base URL before implementation. The documentation pages were readable, but those raw API-host artifacts could not be retrieved through the available GitHub/web connectors during this audit.

**Do not implement request/response types or endpoint payloads from guesses or third-party examples.** Before implementing the Voyage client, obtain and review the production OpenAPI document and agent guide, then record the exact contract version/content used.

## Verification status

| Check | Status |
|---|---|
| Feature branch created from `main` | Passed |
| Repository tree and key source/config files reviewed | Passed |
| Official Creator API overview and agent specification reviewed | Passed |
| Production `openapi.json` retrieved | Blocked — raw API host inaccessible through current connectors |
| Production `agent-guide.md` retrieved | Blocked — raw API host inaccessible through current connectors |
| `npm run typecheck` | Not run — requires local project environment |
| `npm run build` | Not run — requires local project environment |
| Windows packaging build | Not run |

## Next step

Obtain the official production `openapi.json` and `agent-guide.md`, then complete a contract review. After that, implement the isolated Voyage HTTP client and secure credential storage without changing the existing renderer or LM Studio behavior.
