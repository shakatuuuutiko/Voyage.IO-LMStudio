# VoyAgent

Aplicación de escritorio para trabajar con mundos de Voyage Creator Studio usando modelos locales servidos por LM Studio.

## Funciones actuales

- Conexión local con LM Studio mediante la API compatible con OpenAI.
- Conexión autenticada de solo lectura con Voyage Creator API.
- Índice local del GameState, recuperación por rutas y seguimiento de incidencias.
- Propuestas de cambios con revisión individual, controles de tipo y validación antes de aplicar.
- Los cambios se mantienen en un borrador local; guardar en Voyage y publicar son operaciones separadas.

## Requisitos

- Node.js 22.12 o posterior.
- LM Studio ejecutándose en `http://127.0.0.1:1234`.
- Una Player API Key de Voyage Creator API para las funciones de lectura de mundos.

## Desarrollo

El nombre interno del paquete npm permanece como `voyage-io` para conservar compatibilidad con el entorno de desarrollo y su almacenamiento local.

```powershell
npm install
npm run typecheck
npm run dev
```

## Compilación

```powershell
npm run build:win
```

La aplicación empaquetada se presenta como **VoyAgent**. El identificador de aplicación se mantiene como `com.voyage.aicompanion` para conservar la identidad de instalación.
