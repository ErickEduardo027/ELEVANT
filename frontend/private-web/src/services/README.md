# Servicios web

Reservado para adaptadores de API, SignalR y capacidades del navegador. No contiene reglas de negocio ni credenciales.

`planningService.js` es el adaptador remoto de Planificación OCC. Usa `@elevant/api-client`, obtiene el token vigente mediante el servicio de sesión, propaga `AbortSignal` y transforma fallos HTTP en errores genéricos aptos para la interfaz. Distingue sesión expirada (`401`), permiso denegado (`403`) y ambigüedad contractual recuperable (`409`) sin revelar detalles internos. No construye URLs `/api/v1` manualmente ni expone operaciones de escritura que OpenAPI todavía no define.
