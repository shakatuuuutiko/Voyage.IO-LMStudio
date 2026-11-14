# Phase 5 — Remote revision history

VoyAgent now integrates the read-only revision endpoints documented by Voyage Creator API:

- `GET /worlds/{shortId}/revisions` lists immutable saved draft revisions.
- `GET /worlds/{shortId}/revisions/{revisionId}` downloads a historical draft in the current GameState schema.

The application parses the opaque revision ID and creation timestamp, and validates that a downloaded revision contains the selected world's `shortId` and an object-valued `initialGameState`. It does not infer compatibility from the list: a revision download can still fail with Voyage's documented version-mismatch response.

## Renderer workflow

1. Open a world as usual.
2. Select **Consultar revisiones remotas** to request the remote history on demand.
3. Select **Descargar / comparar** for a revision. The downloaded GameState is held in renderer memory and compared against the current local draft.
4. Select **Importar al borrador local** only after reviewing the comparison. The app checkpoints the current local draft, replaces only the in-memory GameState, rebuilds the local index, and clears stale proposals and validation results.

## Mutation boundary

This phase does not call the remote restore endpoint, replace the live Voyage draft, or publish the world. Importing a remote revision is a local draft operation only. The user must run Voyage validation and use the separate conditional-save workflow to change the live draft.

Remote restore remains a future, separately gated operation. Its contract requires a fresh `ETag`, an `If-Match` header, and a unique `Idempotency-Key`; it creates a new live head revision and is not equivalent to local import. It must never be silently triggered by previewing or importing a revision.

## Verification

The implementation is committed on `feature/voyage-creator-api`. Run the local typecheck/build and test the workflow against a world with at least one saved revision. This repository change has not been executed in the user's Windows environment by the assistant.


## Restauración remota de revisiones históricas

La interfaz incorpora ahora una acción remota independiente para restaurar una revisión descargada:

- El cliente vuelve a leer el mundo inmediatamente antes de la mutación y exige un ETag fresco.
- Envía `POST /worlds/{shortId}/revisions/{revisionId}/restore` con `If-Match` e `Idempotency-Key` única generada para esa solicitud.
- No se envía un GameState ni metadatos en el cuerpo: Voyage restaura el contenido histórico a través de su flujo normal y conserva los metadatos actuales.
- La confirmación identifica expresamente que la operación modifica el estado activo remoto y crea una nueva revisión; no publica el mundo.
- Tras la respuesta satisfactoria, la aplicación vuelve a leer el mundo, actualiza documento, ETag, borrador e índice local y crea un snapshot de recuperación.
- Si la mutación se confirma pero falla la lectura posterior, se invalida el ETag local y se exige reabrir el mundo antes de otra operación.
- Si se produce un timeout o se pierde la conexión, no se reintenta automáticamente. El usuario debe reabrir el mundo para comprobar el resultado antes de repetir la acción.
- Los conflictos de revisión y las incompatibilidades se muestran como errores; no se cambia de entorno ni se intenta otra revisión automáticamente.

Esta acción no es equivalente a **Importar al borrador local** ni a **Guardar borrador**. La restauración remota modifica el estado activo de Voyage, mientras que la importación permanece local. Ninguna de las dos publica el mundo.

### Verificación pendiente

En un mundo de prueba con al menos dos revisiones:

1. Descargar y comparar una revisión sin restaurarla; confirmar que no hay cambios remotos.
2. Importarla al borrador local y comprobar que solo cambia el borrador local.
3. Restaurar una revisión con la nueva acción y verificar en Creator Studio que aparece como nueva revisión activa y que los metadatos siguen intactos.
4. Confirmar que la aplicación actualiza el ETag y vuelve a leer el GameState restaurado.
5. Comprobar el comportamiento ante un ETag obsoleto y una revisión incompatible, sin reintentos automáticos.
