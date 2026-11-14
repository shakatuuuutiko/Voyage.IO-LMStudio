# Phase 10 — ITEM_IMAGE upload and local assignment

## Contract verified

The checked-in Creator API Preview 1.3 agent guide documents:

- Image targets include `ITEM_IMAGE`.
- Allowed formats: PNG, JPEG/JPG, and WebP.
- Maximum file size: 5 MiB.
- Gameplay image targets require at least 600 × 600 pixels.
- The upload allowance is requested through `POST /uploads` with `target`, `width`, `height`, and `mimeType`, plus a unique `Idempotency-Key`.
- Raw bytes are sent with HTTP PUT to the signed HTTPS URL using the matching Content-Type.
- Moderation uses `POST /worlds/{shortId}/uploads/{uploadId}/moderate` with `{ "target": "ITEM_IMAGE" }`.
- The canonical `data.imageUrl` is assigned to `initialGameState.itemTypes[itemKey].imageUrl`.
- Moderation does not save or publish the world. Persisting the URL requires the normal validation and conditional world replacement flow with the current ETag.
- A settled `422 studio_media_failed` rejection can be cleaned up. An ambiguous moderation result is not automatically deleted.

## Implementation

- Added `uploadAndModerateItemImage` and shared the transfer/moderation implementation with the existing world-cover upload.
- Enforces the 600 × 600 minimum for `ITEM_IMAGE`; `WORLD_COVER` continues to accept any positive dimensions.
- Added a native file picker in the Electron main process. It checks extension, file signature, decodability, dimensions, and the 5 MiB limit before requesting an allowance.
- Exposed the operation through the preload bridge without exposing the API key or signed upload URL to the renderer.
- Added a UI selector populated from the currently loaded `initialGameState.itemTypes` keys.
- The moderated URL is staged only in the local GameState draft at `itemTypes[itemKey].imageUrl`. Existing object properties are preserved.
- Creates local checkpoints before and after assignment, rebuilds the local index, and invalidates the previous validation result.
- Blocks world switching, validation, and saving while an image upload is in progress.
- Saving still requires successful validation, explicit confirmation, and the existing conditional save flow. No publication is performed.

## Manual verification

1. Pull the feature branch and run `npm run typecheck` and `npm run build`.
2. Open a test world that contains at least one object in `initialGameState.itemTypes`.
3. Select an object and cancel the file picker. Verify no upload is made and the draft remains unchanged.
4. Try an image below 600 × 600 pixels, an unsupported format, a mismatched extension/signature, and a file over 5 MiB. Verify local rejection.
5. Upload a valid PNG/JPEG/WebP of at least 600 × 600 and no more than 5 MiB.
6. Verify moderation succeeds and the URL appears only in the selected object's `imageUrl` in the local draft.
7. Reopen or inspect the local JSON and confirm unrelated item fields remain unchanged.
8. Run Voyage draft validation, then save through the normal conditional flow. Reopen the world and verify the URL persists.
9. Confirm no automatic save or publication occurs during upload or moderation.

No remote world was modified during implementation. Signed-storage interoperability, moderation, and the end-to-end save path still require runtime verification.
