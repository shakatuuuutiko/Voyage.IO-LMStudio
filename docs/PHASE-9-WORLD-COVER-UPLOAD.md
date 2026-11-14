# Phase 9 — Direct world-cover upload and moderation

## Contract verified

The Creator API Preview 1.3 contract and agent guide specify:

- `POST /uploads` requests a temporary allowance using `height`, `mimeType`, `target`, and `width`, with an `Idempotency-Key`.
- Allowed image MIME types are PNG, JPEG/JPG, and WebP. Maximum size is 5 MiB.
- `WORLD_COVER` accepts any positive dimensions; the gameplay asset targets require at least 600 × 600 pixels.
- The allowance response supplies `uploadId`, `directUploadUrl`, and `expiresAt`.
- Raw bytes are sent to the signed URL with HTTP PUT and matching Content-Type before expiry.
- `POST /worlds/{shortId}/uploads/{uploadId}/moderate` with `{ "target": "WORLD_COVER" }` returns the canonical `data.imageUrl`.
- Moderation does not save or publish the cover. The world document's `image` field must be saved separately with conditional world replacement and a current ETag.
- A settled `422 studio_media_failed` rejection can be cleaned up with `DELETE /uploads/{uploadId}`. Successfully moderated uploads cannot be deleted through this endpoint.

## Implementation scope

This phase implements the complete direct-upload flow for **world covers only**. Other targets are intentionally deferred until their GameState attachment paths and UI workflows are implemented.

- Main process opens a native file picker for PNG, JPG/JPEG, and WebP.
- Local validation checks file size, extension/content signature, decodability, and image dimensions before requesting an upload allowance.
- The client requests the allowance with a unique idempotency key, verifies the signed URL uses HTTPS and has not expired, uploads raw bytes with the exact MIME type, then requests moderation with a separate unique key.
- A failed byte transfer triggers best-effort cleanup of the unmoderated upload.
- A settled `studio_media_failed` response triggers cleanup of the rejected upload. An ambiguous moderation outcome is not automatically deleted.
- IPC returns only the canonical moderated URL and basic image metadata; the API key and signed URL remain in the main process.
- The UI stages the moderated URL in the local world document's `image` field. It does not save automatically.
- The existing conditional save flow remains responsible for persisting the cover. It preserves world metadata, requires the normal validation and confirmation path, uses If-Match, and does not publish.

## Manual verification

1. Pull the feature branch and run `npm run typecheck` and `npm run build`.
2. Open a test world and select a valid PNG/JPEG/WebP cover under 5 MiB.
3. Verify the file picker cancellation causes no upload.
4. Verify unsupported extension/content mismatch and files over 5 MiB are rejected locally.
5. Upload a valid cover. Confirm the moderated preview appears and the world is not yet changed remotely.
6. Save through the existing remote-save action, then reopen the world and verify its cover URL persists.
7. Try a moderation rejection (if a safe test image is available) and verify cleanup is attempted.
8. Verify no publication occurs at any point.

No remote world was modified during implementation. API quota behavior, signed-storage interoperability, and the manual save flow still require runtime testing by the user.
