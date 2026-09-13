# Códigos de estado HTTP

Los endpoints deben documentar los códigos que realmente pueden producir. La
tabla siguiente es una pauta para operaciones futuras, no una lista de respuestas
que la API ya publique. Hoy el único endpoint versionado, `GetSystemPing`,
declara `200`, `429` y `500` en OpenAPI; health/readiness son endpoints de
plataforma fuera de ese documento.

| Código | Uso |
| --- | --- |
| 200 | Consulta o actualización completada con cuerpo. |
| 201 | Recurso creado; incluir ubicación cuando sea útil. |
| 202 | Trabajo aceptado pero aún no completado. |
| 204 | Operación exitosa sin cuerpo. |
| 400 | Solicitud mal formada o validación general; usar Problem Details. |
| 401 | Falta autenticación válida. |
| 403 | Identidad autenticada sin permiso. |
| 404 | Recurso no visible o inexistente. |
| 409 | Conflicto de estado, concurrencia o idempotencia. |
| 422 | Semántica válida en JSON pero no procesable, solo si el equipo adopta esta distinción. |
| 429 | Límite de solicitudes excedido. |
| 500 | Error inesperado con mensaje público genérico. |
| 502/503/504 | Dependencia o servicio no disponible, según la capa que detecta el fallo. |

Una colección vacía exitosa devuelve 200 con colección vacía, no 404. Un error de validación no devuelve stack trace. El código no se elige para facilitar una pantalla concreta: refleja el resultado HTTP y el cliente traduce esa semántica a UX.
