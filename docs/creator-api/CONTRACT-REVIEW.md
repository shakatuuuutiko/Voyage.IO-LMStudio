# Creator API 1.3.0-preview — contract review

Reviewed against the checked-in official artifacts:

- `docs/creator-api/openapi.json` (OpenAPI 3.1.0, info version `1.3.0-preview`)
- `docs/creator-api/agent-guide.md`

Production host: `https://api.aidungeon.com/creator/v1`. The OpenAPI server path is relative and must be resolved against the selected host. Do not silently switch environments.

## 1. Confirmed API surface

The contract declares 23 operational endpoints (excluding the two documentation endpoints):

| Domain | Operations |
|---|---|
| Worlds | list, create, read, replace, duplicate |
| Object key order | conditional PATCH order |
| Validation | draft/publish validation |
| Revisions | list, download, restore |
| Publication | publish, unpublish |
| Moderation | read, run |
| Account metadata | mods, usage |
| Images | allowance, direct signed upload, moderate, delete rejected/unmoderated upload, generate area/location/NPC/region-map images |
| Music | upload allowance, direct signed upload, finalize |

Creator Studio chat, conversations, agent runs, cancel, undo, delete worlds/trash and server-pushed events are explicitly unavailable. Our app must not present the local LM Studio assistant as if it can control the Studio agent.

## 2. Authentication and key handling

The OpenAPI security scheme is HTTP Bearer with format `sk-voyage-v1-<token>`. The guide narrows this to Player API keys, requires the key to exist in the selected Player API key store, have the required scope, belong to an active account, and meet the Creator Studio / Creator API rollout requirements (unless the account is a developer).

Implementation policy:

- Ask the creator to create/copy their own key in Voyage; never attempt to create one automatically.
- Send it only in the Authorization header from Electron main process.
- Persist only the encrypted form using Electron `safeStorage`.
- Do not log, return, expose, or include the key in prompts.
- A key's prefix is a format check, not proof of validity or permissions. The authenticated API request is the actual verification.

The guide does not enumerate the exact scope string or provide a fully specified key-creation screen path. UI copy should therefore avoid claiming a particular scope label until verified.

## 3. World data and concurrency

The guide specifies the world read response as `data.world` and an `ETag` response header. A world save is a full replacement envelope containing `world`; preserve `shortId`, all world metadata, and the complete `initialGameState`.

Preview 1.3 canonical ownership is important:

- Shared authored fields remain at the root of `initialGameState`.
- Party-owned state, quests, arcs and narrative events belong under `parties[partyId]`.
- Shared authored triggers use `triggerDefinitions`.
- Preserve every party record and all unknown properties. Do not flatten, normalize, or reconstruct from a partial schema.

Safe write flow: fetch → checkpoint → propose changes → validate → conditional full replacement with current `If-Match` → read back and verify. A 412 means conflict and requires a fresh read plus reconciliation. Do not blindly retry.

## 4. Mutation safety

- Side-effecting POST operations use unique `Idempotency-Key` values; reuse only for an exact retry.
- `request_in_progress` is not permission to create a new key.
- `request_status_unknown` requires reconciliation before any further mutation.
- `studio_unavailable` is a clean pre-side-effect failure with `Retry-After`.
- `studio_version_mismatch` and `revision_version_mismatch` are not fixed by retrying against another host; require creator choice.
- Observe HTTP 429, `Retry-After`, and `RateLimit-*` headers.
- JSON request body limit: 64 MiB.
- Published worlds may trigger moderation/cover-review requirements. Publishing remains a manually confirmed action in this application.

## 5. Contract inconsistencies / missing detail

These are not to be silently papered over:

1. **World list and world envelopes:** OpenAPI declares descriptions for `GET /worlds` and `GET /worlds/{shortId}`, but does not provide complete response schemas/content. The guide says the editable document is at `data.world` and the read response includes ETag. Implement tolerant envelope parsing only after a real response is captured; do not invent a list item type or pagination response shape.
2. **Music finalize idempotency:** the guide says `POST /uploads/music/{uploadId}/finalize` requires a separate `Idempotency-Key`, while the OpenAPI operation omits that header parameter. The guide's global mutation rule says every side-effecting POST requires a key. Follow the guide's safety rule, but record this discrepancy and verify against a live contract response before shipping music upload.
3. **World cover recommended dimensions:** OpenAPI `x-media-constraints` recommends 1280×720; the guide prose says 1000×1000. There is no aspect-ratio rule. Treat the machine-readable OpenAPI extension as the programmatic constraint and do not block other positive dimensions.
4. **NPC portrait recommended dimensions:** OpenAPI recommends 1000×750 (width×height); guide prose says 750×1000. No aspect-ratio rule is specified. Treat OpenAPI as the machine-readable constraint and keep recommendations configurable.
5. **Create/duplicate/publish response bodies:** several successful responses have descriptions but no schema. Do not bind application logic to guessed response fields; use follow-up GET/read-back where the guide defines it.
6. **Exact key scope and eligibility UI:** the guide describes requirements but does not define the literal scope value or fully document key creation UX. Avoid asserting unverified labels in the UI.

## 6. Media constraints from OpenAPI

- MIME: PNG, JPEG/JPG, WebP.
- Maximum file size: 5 MiB.
- Gameplay assets: minimum 600×600 pixels.
- World cover: minimum 1×1; no maximum dimension or aspect-ratio rule.
- Programmatic recommendations from OpenAPI: cover 1280×720; area 750×1333; item 1000×1000; location 750×1333; NPC portrait 1000×750; region map 1000×1000.
- AI image generation requires a paid Voyage plan. It consumes Voyage usage; direct upload is a separate feature.
- Generated or moderated media does not edit the world automatically; insert the returned canonical URL into a downloaded world and save conditionally.

Music is separate: MP3/WAV/OGG/M4A, up to 25 MiB per guide, signed direct upload then finalize. No music generation endpoint exists.

## 7. Current implementation boundary

Implemented in this branch:

- Main-process Voyage HTTP client for authenticated connection checks.
- Encrypted key storage through Electron `safeStorage`.
- IPC methods to inspect key status, save, test and clear a key.
- Typed preload bridge extension. Existing LM Studio IPC methods remain unchanged.

Not implemented yet:

- World listing, reading, local snapshots, editing, validation and synchronization.
- Revisions, restore, moderation, media and publication workflows.
- UI for key setup and world management.
- Live API integration test and Windows build.

The current connection test intentionally treats a successful authenticated `GET /worlds?page=0&type=world` as success without parsing the undocumented response shape.
