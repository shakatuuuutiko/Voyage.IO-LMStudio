# Phase 11 — Remaining moderated image upload targets

## Contract basis

Creator API Preview 1.3 documents six direct image targets: `WORLD_COVER`, `ITEM_IMAGE`, `AREA_IMAGE`, `LOCATION_IMAGE`, `NPC_PORTRAIT`, and `REGION_MAP_IMAGE`.

This phase adds the four remaining content targets:

- `AREA_IMAGE`
- `LOCATION_IMAGE`
- `NPC_PORTRAIT`
- `REGION_MAP_IMAGE`

All four use the documented direct upload allowance, signed HTTPS PUT, and moderation flow. Gameplay assets require at least 600 × 600 pixels and all images are limited to 5 MiB. PNG, JPEG/JPG, and WebP are supported. OpenAPI provides recommended dimensions, but no aspect-ratio rule; recommendations are not enforced as hard limits.

## Important schema boundary

The reviewed agent guide explicitly maps `ITEM_IMAGE` to `initialGameState.itemTypes[itemKey].imageUrl` and `WORLD_COVER` to `world.image`. It does not specify a universal GameState property path for area, location, NPC portrait, or region map images.

VoyAgent therefore does not guess those property names or create new fields. The UI requires the user to enter a JSON Pointer path, relative to `initialGameState`, that points to an existing string or null image field. The path is checked against the current local draft before opening the file picker. Only that existing field is replaced with the canonical moderated URL.

JSON Pointer escaping follows RFC 6901 (`~1` for slash and `~0` for tilde). Array indices are accepted only when they resolve to an existing element.

## Implementation

- Extended the shared upload/moderation client to accept all documented targets.
- Preserved the `WORLD_COVER` dimension exception; all other targets enforce 600 × 600 minimum dimensions.
- Added a main-process file picker and checks for extension, actual file signature, decodability, dimensions, and 5 MiB maximum.
- Added an IPC/preload operation for the four remaining targets. The API key and signed URL remain in the main process.
- Added a renderer panel to select the moderation target and provide an existing image-field JSON Pointer.
- The renderer rejects missing paths and values other than string or null before upload.
- After moderation, only the selected local draft field is changed. The validation result is invalidated, the local index is rebuilt, and local checkpoints are attempted.
- Conflicting world operations are blocked while an upload is active.
- No remote world save or publication is performed automatically.

## Manual verification

1. Run `git pull origin feature/voyage-creator-api`, `npm run typecheck`, `npm run build`, and `npm run dev`.
2. Open a test world and inspect its GameState JSON to identify an existing image field appropriate for one of the four targets. Do not invent a property path.
3. Enter its JSON Pointer relative to `initialGameState`. Verify the current value preview shows the expected string or null.
4. Enter a nonexistent path or a path to an object/array/number. Verify the app refuses to upload.
5. Test each moderation target only against an appropriate image field and entity. Use a valid PNG/JPG/WebP of at least 600 × 600 and at most 5 MiB.
6. Verify moderation returns a canonical URL and only the selected local field changes.
7. Run Voyage validation and save through the normal ETag/If-Match flow. Reopen the world and verify persistence.
8. Confirm upload/moderation itself does not save or publish the world.

No remote world was modified during implementation. Live moderation and target-to-entity compatibility still require runtime verification against a test world.
