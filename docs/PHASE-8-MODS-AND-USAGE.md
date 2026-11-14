# Phase 8 — Mod inventory and Creator Studio usage

## Contract verified

Creator API Preview 1.3 documents two read-only endpoints:

- `GET /mods`: lists owned, bookmarked, pending, and remix-source mods. Optional query parameters include `pendingModShortId` (array, maximum 100) and `remixSourceShortId`.
- `GET /usage`: reads Creator Studio AI usage limits.

The OpenAPI contract does not define detailed response schemas for either endpoint. The agent guide confirms that these endpoint families are read-only and that AI-generated media consumes paid-plan Usage. It does not provide a stable field-level response contract.

## Implementation

- Added client methods `listMods()` and `getUsage()`.
- Added IPC handlers and preload declarations.
- Added two account-panel actions: `Consultar mods disponibles` and `Consultar uso y límites de IA`.
- The UI displays the original JSON response without assuming undocumented property names or calculating quotas.
- The UI explicitly states that this integration can inspect mods but cannot install, activate, or remove them; no such operation is exposed by the reviewed contract.
- No remote state is changed by either operation.

## Manual verification

1. Pull the feature branch and run `npm run typecheck` and `npm run build`.
2. With a configured Voyage API key, select `Consultar mods disponibles`; verify the response is displayed as JSON.
3. Select `Consultar uso y límites de IA`; verify the response is displayed as JSON.
4. Test both actions with an invalid or revoked API key and confirm that errors are shown without exposing credentials.
5. Confirm that these actions do not modify worlds or mod state.

The response shapes remain intentionally unnormalized until Voyage publishes a detailed schema. These checks are pending user execution.
