# Voyage Creator API agent guide

The Creator API is a preview, server-to-server API for editing Voyage worlds owned by the creator whose key is used.

## Discover the contract

- Base path: `/creator/v1`
- Use production by default: `https://api.aidungeon.com/creator/v1`. Create, edit, validate, and publish through that same host; review the world at `https://voyage.io/studio`.
- Use Alpha, Beta, or development only when the creator explicitly requests that environment. Fetch its OpenAPI contract and guide before working. The OpenAPI server URL is deliberately relative to the selected API host; it does not redirect requests to production. Never persist or redistribute an `api-pr-<number>.preview...` host: PR previews are ephemeral and disappear when the PR closes or loses its preview label.
- OpenAPI: `GET /creator/v1/openapi.json`
- This guide: `GET /creator/v1/agent-guide.md`
- Player API keys use the identifiable `sk-voyage-v1-<token>` format. Send `Authorization: Bearer <player-api-key>` on every endpoint except the two documentation endpoints.
- Do not send an `Origin` header. Browser-origin requests are rejected.

The key is accepted only while it exists in the selected Player API key store, has the required scope, belongs to an active account, and the account is either a developer or retains both Creator Studio and Creator API rollout access. World operations remain owner-only, including for developers.

## Environment compatibility

Alpha and Beta can upgrade the shared world draft beyond production's supported Voyage version or compatibility revision. A draft upgraded there may no longer open or publish on production until production supports it. Publishing on production does not downgrade a draft. Never change version fields to bypass compatibility checks or automatically retry a mutation against another host.

For a world that already requires a newer environment, explain the incompatibility and let the creator choose a compatible environment before proceeding. Use production from the start for worlds intended for production players.

## Safe world edit loop

1. List owned worlds with `GET /worlds`.
2. Download the live draft with `GET /worlds/{shortId}`. Save the response's `ETag`.
3. Keep a local copy as your checkpoint.
4. Change `data.world`, preserving its `shortId` and complete `initialGameState`.
5. Check the document with `POST /validate`.
6. Replace the draft with `PUT /worlds/{shortId}` and `If-Match: "<etag>"`.
7. Read the world again and verify the intended change.
8. Publish only when the creator explicitly asked for publication.

Publishing a Mature world automatically refreshes missing or outdated cover-review evidence
needed for Default discovery, using a full review and the normal moderation limits. An unchanged, reviewed cover
does not need another rating check. The creator's Mature rating is preserved. Public text and
cover safety still determine eligibility; publishing does not guarantee Default discovery.
If the required review cannot complete, publication fails instead of silently dropping discovery
eligibility. Publishing shares the costly-request rate limit. A `429 moderation_daily_limit`
releases the idempotency claim, so the same request/key can be retried after the limit resets.
Use a new idempotency key after resolving other completed review failures.

A stale `If-Match` fails with `412 revision_conflict`; re-read, reconcile, and retry. Never retry a stale full replacement blindly.

## JSON key order

Full replacements preserve the supplied key order, including record collections such as npcs. Keep the downloaded order when making ordinary value edits.

To rearrange keys without sending their values, call `PATCH /worlds/{shortId}/order` with `If-Match` and `{"path":["npcs"],"keys":["Guide","Merchant"]}`. The path starts inside initialGameState; use additional segments for nested objects. Listed existing keys come first; unlisted keys retain their relative order afterward. Arrays are not reorder targets. Integer-index object keys must remain in ascending numeric order. A concurrent change returns 412; download the latest draft before retrying.

## Revision history and restore

- `GET /worlds/{shortId}/revisions` lists immutable saved draft revisions, oldest first.
- `GET /worlds/{shortId}/revisions/{revisionId}` downloads one revision in the current GameState schema.
- Preview 1.3 responses use canonical ownership: shared fields are at the root; quests, arcs, narrative events, and party state are under `parties[partyId]`; authored shared triggers are `triggerDefinitions`. Preserve every party record when replacing a document. Versioned flat uploads from preview 1.2 are accepted only through the explicit import boundary and returned in canonical form. Unversioned flat uploads are unsupported. Download a fresh document before editing; do not reuse the old response layout.
- History is shared across environments. A listed revision may require a newer Voyage version or compatibility revision than the API host supports. Download and restore return `409 revision_version_mismatch` for that revision (or an incompatible imported mod), before any live draft mutation. Explain the incompatibility and get the creator’s explicit choice before using a compatible environment’s API host; restore releases its idempotency claim. Older compatible revisions still convert forward to the current schema.
- Historical downloads contain `shortId` and `initialGameState`. They do not contain historical world metadata.
- To deliberately return to historical content, first read the current world for a fresh `ETag`, then call `POST /worlds/{shortId}/revisions/{revisionId}/restore` with that `If-Match` value and an `Idempotency-Key`.
- Restore is forward-only: it saves the historical GameState through the normal live-room funnel as a new head revision. It does not rewrite or delete the selected revision or the state that was current before restore. Current world metadata is preserved.

Revision IDs are opaque. A save may be absent from history if its best-effort immutable copy failed, even though the durable live save succeeded.

## Endpoint families

- Worlds: list, create, download, replace, and duplicate.
- Publication: publish, unpublish, read moderation, and run moderation.
- Validation: validate a draft or the stronger publish stage.
- Mods and limits: list available mods and read Creator Studio AI usage.
- Media: create an upload allowance, upload to the signed URL, moderate the upload, clean up a rejected upload, or generate an image. Media responses do not edit the world; place the returned URL into the downloaded world and use the conditional replace flow.
- AI-generated media requires a paid Voyage plan and consumes that plan's Usage. Free-trial Usage is not available through this server-to-server API; direct image uploads remain available under their separate limits.

World deletion, trash management, Creator Studio chat, Studio agent conversations, agent runs, cancellation, undo, and server-pushed events are not exposed.

## Direct image upload flow

The top-level `x-media-constraints` block in OpenAPI is the programmatic source of upload rules. All uploads allow at most 5 MiB. Gameplay asset targets require at least 600 x 600 pixels. `WORLD_COVER` accepts any positive dimensions and uses the same cover moderation as Studio. There is no maximum pixel dimension or required aspect ratio. Recommended dimensions are:

- `WORLD_COVER`: 1000 x 1000
- `AREA_IMAGE`: 750 x 1333
- `ITEM_IMAGE`: 1000 x 1000
- `LOCATION_IMAGE`: 750 x 1333
- `NPC_PORTRAIT`: 750 x 1000
- `REGION_MAP_IMAGE`: 1000 x 1000

Allowed MIME types are `image/png`, `image/jpeg`, `image/jpg`, and `image/webp`. The upload contract is:

1. Inspect the image locally, then call `POST /uploads` with `target`, `width`, `height`, and `mimeType`. Invalid dimensions fail with `422 invalid_image_dimensions` before an allowance or stored object is created.
2. Read `data.uploadId`, `data.directUploadUrl`, and `data.expiresAt`. `dailyUploadCount` includes completed uploads and active pending allowances issued today, including the new allowance.
3. Before `expiresAt` (currently about five minutes after issue), send the raw bytes to `directUploadUrl` with HTTP `PUT` and a `Content-Type` matching `mimeType`. If it expires, request another allowance with a new `Idempotency-Key`.
4. Call `POST /worlds/{shortId}/uploads/{uploadId}/moderate` with `{ "target": "ITEM_IMAGE" }` for an item (or the corresponding target for another image type). On success, `data.imageUrl` is the canonical internal URL to place in the world document. For an item, set `initialGameState.itemTypes[itemKey].imageUrl`, then save through the conditional replace flow with the current `ETag`. For a world cover, use `WORLD_COVER` in both requests and set `world.image` to `data.imageUrl` in the downloaded document. Moderation does not save or publish the cover; use `PUT /worlds/{shortId}` with `If-Match` and a new `Idempotency-Key` to save it.
5. A `422 studio_media_failed` is a settled rejection before any world edit. Correct the image, use a new upload and a new idempotency key, and call `DELETE /uploads/{uploadId}` to remove the rejected or unmoderated object. Successfully moderated uploads cannot be deleted through this endpoint because a world may already reference them.

## Direct music upload flow

1. Call `POST /uploads/music` with `{ "mimeType": "audio/mpeg" }` and an `Idempotency-Key`.
2. PUT the raw audio bytes to `data.directUploadUrl` within five minutes, using the canonical Content-Type (MP3: `audio/mpeg`, WAV: `audio/wav`, OGG: `audio/ogg`, M4A: `audio/mp4`). Supported files are MP3, WAV, OGG, and M4A, up to 25 MiB. Accounts must be 48 hours old; each issued allowance counts toward the separate 200-per-day music limit, including failed or abandoned uploads.
3. After a successful PUT, call `POST /uploads/music/{uploadId}/finalize` with a separate `Idempotency-Key`. This retrieves `data.musicUrl` after the API has decoded the uploaded audio, converted it to MP3 without metadata, and stored it. The PUT response also includes `musicUrl`.
4. Before the reservation's `expiresAt`, set the variant's `url` or `narrationUrl` under `initialGameState.gameplayMusicSettings.tracks` to `data.musicUrl` using the safe world edit loop.

If signing fails after a music slot is reserved, the idempotency key remains protected; an exact retry returns `409 request_in_progress` while that claim is retained. Do not automatically switch keys to retry: a new key requests another quota slot.

Reserved or finalized music that is never saved expires after 24 hours and is removed by the existing VGF cleanup sweep. Partial, failed, canceled, and replaced-before-save uploads follow the same lifecycle. Music referenced by durable Studio revisions remains available for recovery.

Music is handled through manual world reports (the music category), not the image moderation or image cleanup endpoints. Upload only music the creator has permission to use. Music generation is not available.

## Mutation and failure rules

- Every side-effecting `POST` requires a unique `Idempotency-Key`. Reuse the same key only for an exact retry of the same request.
- `PUT` safety comes from `If-Match`; validation requests do not require idempotency.
- The JSON request limit is 64 MiB.
- Errors use `{"error":{"code":"...","message":"..."},"requestId":"..."}`.
- Clean pre-side-effect failures—including `studio_unavailable`, input/eligibility errors, rate limits, and revision conflicts—release the pending idempotency claim. Retry an identical request with the same key only when the error says it is retryable; use a new key after changing the request.
- `studio_unavailable` is a clean availability failure, not an unknown mutation outcome. It includes `Retry-After` (normally 5 seconds), is safe to retry, and does not require state reconciliation. Repeated failures after backoff should be escalated with the `requestId`.
- `409 studio_version_mismatch` means the world was saved with a different Voyage version than this environment. It is not retryable. An older world must be opened in the selected environment’s Creator Studio once so the creator can confirm the upgrade; a newer draft requires a compatible environment explicitly chosen by the creator. Tell the creator rather than retrying.
- If a request returns `request_in_progress`, the key remains protected for the 24-hour replay window. `Retry-After` is the earliest useful recheck, not an expiry promise.
- A `request_status_unknown` response means the room mutation may have completed but its response was lost. The key remains protected for the full 24-hour replay window. Reconcile the live world and Studio state before retrying; this applies to world replacement and publication convergence.
- Respect `429`, `Retry-After`, and the `RateLimit-*` headers.

Treat the OpenAPI document as the canonical list of paths, request shapes, and response statuses. Treat this guide as the canonical workflow and safety policy.
