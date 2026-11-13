# Phase 1 — Voyage connection foundation

Branch: `feature/voyage-creator-api`

## Implemented

- Production-only base URL: `https://api.aidungeon.com/creator/v1`.
- Main-process authenticated HTTP client with a 30-second timeout and structured HTTP error details.
- Connection check uses `GET /worlds?page=0&type=world`. It does not assume undocumented response properties.
- A read-only `GET /worlds/{shortId}` path is implemented in the main-process client and IPC bridge. It validates the documented `data.world` envelope and preserves the complete `initialGameState` and unknown world fields; it captures the `ETag` for a later conditional save.
- Player API key is validated for the documented `sk-voyage-v1-` prefix and non-empty token.
- Electron's asynchronous `safeStorage` API encrypts the key before it is written under the app's user-data directory. This avoids the synchronous API deprecated for removal in Electron 46 and supports key rotation.
- The renderer receives only status/result objects. The key is not returned from main-process IPC.
- Voyage error text crossing IPC is redacted for strings matching the documented Player API key prefix, preventing accidental credential echo from reaching the renderer.
- Existing LM Studio IPC channels and behavior are preserved.
- BrowserWindow explicitly declares `contextIsolation: true` and `nodeIntegration: false`. `sandbox` remains false until preload compatibility is tested.
- Builder `appId` now matches the runtime ID (`com.voyage.aicompanion`); the example.com update feed has been removed until a real update service exists.
- Package metadata no longer contains the template author/homepage values.
- Updated `postinstall` to run the Electron 42+ `install-electron --no` binary bootstrap explicitly, followed by `electron-builder install-app-deps`. Electron 42+ no longer downloads its binary in the package postinstall hook; the `install-electron` executable is declared in the locked Electron package.

## Configure the key

1. Open a world in Voyage Creator Studio.
2. Select **Settings → API keys**.
3. Enter a label and select **Generate**.
4. Copy the key immediately; Voyage shows it only once.
5. In Voyage AI Companion, paste it into **Cuenta Voyage → Player API Key** and select **Guardar API Key**.
6. Select **Probar conexión**. A successful result confirms authenticated access to the owned-world listing endpoint.
7. Restart the app and confirm the status still says the key is saved. The key itself should not reappear in the password field.
8. Use **Eliminar API Key** to remove the encrypted local credential.

Never paste the key into a chat, issue, log, source file, or screenshot.

## Local verification on Windows

From the repository directory in PowerShell:

```powershell
node --version
git fetch origin
git switch feature/voyage-creator-api
git pull
npm ci
npm run typecheck
npm run build
npm run dev
```

Use Node.js 22.12 or newer. The lockfile resolves Electron 44.11.3, whose declared engine requirement is `>=22.12.0`; the lower Node 20.19 minimum accepted by Vite/electron-vite is not sufficient for this Electron version. Then verify:

- The app opens without a preload/IPC error.
- LM Studio still lists models and returns a chat response.
- Voyage key save works and the field clears after saving.
- The saved-key status survives an app restart.
- The connection test succeeds with an eligible key.
- Clearing the key changes the status to unconfigured.

If the API test returns 401 or 403, do not share the key. Report only the HTTP status and sanitized error text; the key may be invalid, revoked, missing the required scope, or the account may not have the required rollout access.

## Live list schema confirmed

A successful account response for `GET /worlds?page=0&type=world` confirmed this envelope:

- `data.totalCount`: total number of matching worlds.
- `data.worlds`: array of world summaries.
- `requestId`: request correlation identifier.

Observed summary fields include `id`, `shortId`, `title`, `description`, `advancedDescription`, `image`, `createdAt`, `updatedAt`, `editedAt`, `visibility`, `published`, `publishedAt`, `mods`, `tags`, `contentRating`, ownership/lock flags, and engagement counters. The renderer only depends on a validated minimum subset and leaves the original response intact in the main process.

The renderer now parses `data.worlds` and displays a read-only list with cover, title, description, visibility, publication status, and mod count. Selecting **Abrir / leer mundo** calls the already implemented `GET /worlds/{shortId}` path and displays the returned document and ETag. No write operation is triggered by selecting or reading a world.

## Live single-world read confirmed

A real read of **Cazadores de Cicatrices** (`shortId: DTeaerkFPOAF`) was completed through the application's **Abrir / leer mundo** inspector. The inspector export in `tempcopi.txt` records the successfully parsed world document and response ETag.

Confirmed behavior:

- The API response is accepted through the documented `data.world` envelope.
- The returned world document is a complete object with `shortId`, metadata, and `initialGameState`.
- The response supplied an ETag; the inspector displayed it as `W/"R9rHycl4AzaHWzlusdAzCEzw-ajqRKWHBYaMgsCoSzo"`.
- The observed `initialGameState` contains 40 top-level keys, including shared definitions and authored content such as `gameModes`, `factions`, `skills`, `locations`, `npcs`, `mods`, `triggerDefinitions`, and `parties`.
- In this world, `parties` is an object with one observed entry whose key is the empty string. That entry contains `quests`, `questTriggers`, `arcs`, and `narrativeEvents`. Preserve this key and its contents exactly; do not normalize it or assume it is invalid.
- The JSON document parses successfully. The main-process client returns the parsed world object and ETag separately to the renderer.

This confirms the read path and ETag capture for this tested world. It does **not** validate PUT/If-Match behavior, round-trip fidelity, or any mutation workflow.

## Draft validation integration

The application now exposes **Validar borrador (sin guardar)** after a world has been read. It calls `POST /validate` with `{ stage: "draft", world: { initialGameState } }`, matching the checked-in OpenAPI `ValidationRequest` schema. The response is checked for `data.valid`, `data.stage`, `data.errors`, `data.warnings`, and `requestId`; issue entries are displayed with their code, message, and JSONPath. The call does not write or otherwise mutate the world. Publish-stage validation is intentionally not exposed in this phase.

Live account validation still needs to be run locally. Record whether the endpoint accepts the captured world and inspect any returned errors/warnings before designing editable proposals. PUT/If-Match, save, restore, and publication remain unimplemented.

No publication, unpublication, world replacement, revision restore, moderation, media upload, or other mutating Voyage operation is exposed by this phase.


## Live worlds-list inspection

The application now exposes a read-only **Consultar mis mundos** action after a Player API key has been saved.

- The action invokes the existing `GET /worlds?page=0&type=world` client method through main-process IPC.
- The response is displayed as formatted JSON without assuming undocumented list fields.
- No world is edited, published, unpublished, reordered, duplicated, or deleted.
- Use this live response to confirm the list envelope and item fields before implementing the world browser.
- Do not share API keys or credential-bearing screenshots. The response itself should not contain the API key.

After pulling the feature branch and starting the app, select **Consultar mis mundos**. If the request succeeds, copy the JSON response from the inspector and provide it for schema analysis. If it fails, provide only the HTTP status and sanitized error text.


## Global local-AI proposal and recommendation workflow

The initial single-section proposal editor has been replaced by a free-form, world-wide workflow:

- The user describes the desired outcome without choosing a section. LM Studio receives the current `initialGameState` as compact JSON and is asked to identify all relevant sections and propose coordinated changes.
- The **Recomiéndame** action works without a user prompt. It asks the local model to inspect the world and return prioritized recommendations covering repairs, consistency, content, depth, systems, balance, and expansion opportunities.
- If draft validation has errors, **Proponer correcciones de validación** sends the current validation issues and draft to the local model for a targeted repair proposal.
- The structured response supports JSON paths across multiple sections, value replacements/additions at leaf paths, and explicit property removals. The renderer rejects malformed paths, missing/non-editable parents, prototype-related path segments, duplicate paths, and oversized proposals.
- The review panel shows each full path, category, reason, current value, and proposed value/removal. Recommendations that are explanatory rather than safely expressible as GameState edits are shown separately.
- The model is instructed not to invent root properties, schema fields, IDs, or configuration keys. The renderer can verify path existence and safe application, but the authoritative compatibility check remains Voyage's `POST /validate` endpoint.
- Applying accepted changes mutates only the renderer's in-memory draft. It does not call Voyage. The user can discard a proposal or restore the draft from the downloaded original.
- The workflow remains local-AI-only and preserves the manual review boundary. No PUT/save, automatic publication, or remote mutation is introduced.

### Important context-size limitation

The global workflow sends the compact current GameState to the selected local model. A large world may exceed that model's context window even when the JSON is syntactically valid. In that case, LM Studio may truncate or fail to process the request; increase the model's context length or use a model with a larger context window. The application must not silently claim that an incomplete analysis covered the whole world.

### Verification status

The code changes are committed to `feature/voyage-creator-api`, but they have not been run through the user's Windows/LM Studio environment from this development session. Local `npm run typecheck`, app startup, proposal generation, recommendation generation, and live draft validation must be checked after pulling the branch. No change has been merged into `main`.
