# Servicios web

Reservado para adaptadores de API, SignalR y capacidades del navegador. No contiene reglas de negocio ni credenciales.

`planningService.js` es el adaptador remoto de Planificación OCC. Usa `@elevant/api-client`, obtiene el token vigente mediante el servicio de sesión, propaga `AbortSignal` y transforma fallos HTTP en errores genéricos aptos para la interfaz. Distingue sesión expirada (`401`), permiso denegado (`403`) y fallos recuperables sin revelar detalles internos. Expone la asignación inicial revisada por OpenAPI, conserva el `ETag` fuerte como valor opaco y marca como ambiguo cualquier resultado de escritura que deba refrescarse antes de volver a intentar. No construye URLs `/api/v1` manualmente ni conserva credenciales.
