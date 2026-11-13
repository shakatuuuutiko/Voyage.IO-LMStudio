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
- Existing LM Studio IPC channels and behavior are preserved.
- BrowserWindow explicitly declares `contextIsolation: true` and `nodeIntegration: false`. `sandbox` remains false until preload compatibility is tested.
- Builder `appId` now matches the runtime ID (`com.voyage.aicompanion`); the example.com update feed has been removed until a real update service exists.
- Package metadata no longer contains the template author/homepage values.
- Removed an undeclared `install-electron` command from `postinstall`; Electron's declared package handles its binary install, and the project now runs the declared `electron-builder install-app-deps` hook.

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

Use Node.js 20.19+ or 22.12+ (the current `electron-vite` engine requirement). Then verify:

- The app opens without a preload/IPC error.
- LM Studio still lists models and returns a chat response.
- Voyage key save works and the field clears after saving.
- The saved-key status survives an app restart.
- The connection test succeeds with an eligible key.
- Clearing the key changes the status to unconfigured.

If the API test returns 401 or 403, do not share the key. Report only the HTTP status and sanitized error text; the key may be invalid, revoked, missing the required scope, or the account may not have the required rollout access.

## Not yet implemented

The read-only single-world download path is implemented, but it has not been tested against a live account. The next stage depends on capturing successful responses for `GET /worlds` and `GET /worlds/{shortId}`. The list response is undocumented in OpenAPI, and the single-world envelope is specified by the guide as `data.world`; a live response must confirm both envelope and ETag behavior before building the visible world browser or any edit/sync operation.

No publication, unpublication, world replacement, revision restore, moderation, media upload, or other mutating Voyage operation is exposed by this phase.
