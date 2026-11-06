# Servicios web

Reservado para adaptadores de API, SignalR y capacidades del navegador. No contiene reglas de negocio ni credenciales.

`planningService.js` es el adaptador remoto de Planificación OCC. Usa `@elevant/api-client`, obtiene el token vigente mediante el servicio de sesión, propaga `AbortSignal` y transforma fallos HTTP en errores genéricos aptos para la interfaz. Distingue sesión expirada (`401`), permiso denegado (`403`) y fallos recuperables sin revelar detalles internos. Expone la asignación inicial revisada por OpenAPI, conserva el `ETag` fuerte como valor opaco y marca como ambiguo cualquier resultado de escritura que deba refrescarse antes de volver a intentar. No construye URLs `/api/v1` manualmente ni conserva credenciales.

`dashboardService.js` combina lecturas canónicas de planificación, revisión y notificaciones OCC para una estación autorizada y su fecha local según la zona IANA devuelta por la API. Rechaza respuestas de otra estación, filtra los avisos de la cuenta por estación y deja explícitos los límites de paginación. No mantiene datos de prueba ni calcula indicadores históricos.

`accountChangeObserver.js` trata SignalR como una pista para releer el feed HTTP autorizado. Desactiva el registro interno del transporte en el navegador: SignalR podría incluir el token de acceso en la URL WebSocket que registra a nivel informativo. El cursor y los reintentos siguen funcionando sin ese registro.

`flightMonitoringService.js` deriva horarios y estado registrado de planificación OCC. No inventa telemetría en la aplicación remota; su refresco periódico consulta la misma estación seleccionada y entrega snapshots completos para retirar vuelos desaparecidos. Una falla de refresco se muestra como desconexión y borra el resultado anterior hasta que la consulta se recupere.

`positionsMapService.js` superpone las asignaciones OCC sobre la cartografía PUJ disponible localmente. Para otras estaciones devuelve solo los stands que aparecen en la planificación autorizada, sin coordenadas ni supuesta disponibilidad; la vista los presenta como lista. El refresco usa la estación seleccionada y entrega snapshots completos, con fallo visible y sin reutilizar resultados anteriores.

`problemMessages.js` es el núcleo que convierte un fallo de la API en un mensaje en español: primero la sesión expirada (`401`), luego el `code` de Problem Details según el mapa del área y los códigos comunes (`version_conflict`, `idempotency_conflict`, `reason_required`…), después el permiso (`403`), el registro inexistente (`404`), el conflicto (`409`), los datos inválidos (`400`) y, por último, el respaldo. Nunca devuelve el `title` del servidor ni el texto de una excepción. Cada área publica su mapa sobre ese núcleo; `commercialProblems.js` cubre Solicitudes, Aprovisionamiento y Aerolíneas.

`commandKeys.js` guarda la `Idempotency-Key` de una intención del usuario: conserva la misma UUID mientras se reintenta la misma acción con el mismo cuerpo tras un resultado incierto (sin respuesta o `5xx`) y la descarta tras cualquier `2xx` o `4xx`. En React se guarda en `useRef(createCommandKeyHolder())`.

`billingUnits.js` muestra las unidades de cobro en español y traduce un nombre heredado («operación») al código activo de «Unidades de cobro». El ciclo comercial guarda siempre el código; las pantallas proponen una unidad activa y nunca envían el nombre.

`financeErrors.js` reúne los mensajes de Finanzas por `code`: la aprobación de contratos, los tarifarios de servicios y cargos, las unidades de cobro y las tasas de cambio. `financePackagesService.js` hace lo mismo para los paquetes, incluidos el descarte y el retiro.
