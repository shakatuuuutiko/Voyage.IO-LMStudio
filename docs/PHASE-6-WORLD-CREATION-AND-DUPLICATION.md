# Phase 6 — World creation and duplication

This phase adds the Creator API world mutation endpoints:

- `POST /worlds` creates a world using the documented `{ "world": ... }` envelope.
- `POST /worlds/{shortId}/duplicate` creates an independent copy of an owned world.

## Creation workflow

The Voyage panel includes a creation form with:

- Required title.
- Optional description.
- Initial visibility (`private` or `unlisted`).
- Explicit JSON object for `initialGameState`, defaulting to an empty object.

The client validates the JSON object and documented tag constraints, sends a unique `Idempotency-Key`, and does not automatically retry. The UI asks for confirmation before the remote mutation. After success, it refreshes the owned-world list; a refresh failure is reported separately from the successful creation.

## Duplication workflow

Each listed world has a **Duplicar mundo** action. It requires explicit confirmation and sends the documented duplicate request with a unique `Idempotency-Key`. The original world is not edited. The returned duplicate is not published automatically.

## Safety and failure handling

- Both operations are explicit user actions and require a configured Creator API key.
- Each mutation receives a fresh UUID idempotency key.
- The app never automatically retries a create or duplicate request after timeout or an ambiguous transport failure. Repeating with a new key could create a second world.
- When the outcome is uncertain, the UI instructs the creator to refresh the owned-world list and reconcile the result before retrying.
- Neither operation publishes, moderates, nor modifies the original world.
- Creation currently uses a user-supplied initial GameState object. A richer schema-aware starter-template builder remains a future enhancement.

## Verification

Run `npm run typecheck`, `npm run build`, then verify against a test account:

1. Create a private test world with a simple initial GameState.
2. Confirm it appears in the owned-world list and can be opened and read.
3. Duplicate the test world.
4. Confirm the duplicate has a distinct `shortId`, opens independently, and the original remains unchanged.
5. Confirm neither new world is published.
6. Simulate or observe a connection failure and confirm the UI asks to refresh the list before retrying.

These changes are committed on `feature/voyage-creator-api`; they have not been executed in the user's Windows environment by the assistant.
