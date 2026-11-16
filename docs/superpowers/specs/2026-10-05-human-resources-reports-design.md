# Reportes verificables de Gestión Humana: diseño

Estado: diseño aprobado conversacionalmente el 5 de octubre de 2026 para el [plan operativo de G.H.](2026-10-04-human-resources-operational-interviews-design.md). Su [plan de implementación](../plans/2026-10-05-hr-reports.md) está en ejecución; no describe funcionalidad desplegada.

## Propósito y alcance

G.H. necesita consultar y exportar datos actuales para vigencias, movimientos de cuenta, distribución de turnos y cobertura de habilitaciones. La página remota existente solo muestra una muestra de hasta 100 registros por fuente; el módulo heredado de reportes usa stores en memoria y genera descargas locales. Ninguna de esas vistas debe prometer un total global ni servir como exportación formal.

Este subproyecto sustituye la ruta activa `/gestion-humana/reports` por reportes de API. No cambia la edición de perfiles, permisos, habilitaciones o turnos, no crea nómina y no calcula horas extra legales. Las alertas provisionales de descanso/horas y los avisos durables son otro subproyecto; su especificación se revisará aparte. La API compartida y DevelopmentDB siguen siendo las únicas fuentes de verdad.

## Contrato de lectura

La API publica `GET /api/v1/human-resources/reports/{kind}` con `kind` en `expirations`, `account-movements`, `staff-distribution` o `qualification-coverage`. Todos exigen JWT, rol vigente `GESTION_HUMANA` de BackOffice, membresía interna AVIAM activa y `stationId` concedida en el servidor en el instante de lectura. Ni `SUPERADMIN` ni la presencia de una estación en un token sustituyen ese permiso. Una estación fuera de alcance devuelve 404 sin datos de terceros; pérdida del rol devuelve 403 y borra la vista previa. Respuestas privadas usan `Cache-Control: no-store`.

Cada clase define filtros validados por la API, fechas locales ISO y página de 1 a 100. El intervalo, cuando aplica, tiene como máximo 30 fechas inclusivas; la API no acepta un rango abierto ilimitado. El orden es estable por fecha y clave interna, de modo que `hasMore` no depende de coincidencias casuales. Cada respuesta contiene `stationId`, filtros efectivos, `asOf`, `page`, `limit`, `hasMore` y filas tipadas. Los conteos mostrados en UI son de la página, salvo que el servidor devuelva explícitamente un total filtrado. La UI no agrega páginas parciales para llamarlas total global.

- `expirations`: habilitaciones y permisos de agentes vigentes para la estación; filtros por clase, estado de vigencia y fecha de vencimiento. La vigencia se determina en la API a partir de fechas y estado canónico; la UI no recompone una regla alternativa.
- `account-movements`: altas, bajas, reactivaciones y revocaciones de cuentas vinculadas a agentes con alcance en la estación. Se toma de eventos de auditoría tipados, no de texto libre ni de reconstruir historia desde el estado actual. Si un evento carece de asociación verificable a la estación, no se atribuye a ella; la API presenta la limitación, no inventa el vínculo.
- `staff-distribution`: una fila por turno confirmado con fecha, agente, estación, terminal, posición y horas locales. Es volumen de turnos, no número de personas únicas.
- `qualification-coverage`: una fila por tipo de equipo con agentes habilitados y universo de agentes elegibles de la estación según alcance vigente. La definición y denominador se publican en el contrato; no se infiere cobertura de la muestra paginada.

El cliente OpenAPI generado valida estas formas. La UI conserva loading, empty, recoverable error y unauthorized, filtros en URL donde no incluyan datos privados, y reconsulta al volver a foco, reconectar o recibir una pista autorizada. Las pistas nunca contienen filas del informe. No se presenta información de prototipo como actual.

## Exportación completa y segura

`GET /api/v1/human-resources/reports/{kind}/export?format=pdf|xlsx` recibe los mismos filtros, sin `page` ni `limit`. La API vuelve a autorizar rol y estación y lee un snapshot del conjunto filtrado en un solo momento lógico. El archivo contiene todas las filas de ese snapshot, no solo la página visible, junto con filtros, fecha de generación, estación y número de filas. Se fija un máximo inicial de 5 000 filas; si hay 5 001 o más, devuelve `422` con Problem Details y no entrega archivo parcial. Un filtro vacío válido produce un documento con encabezado y cero filas, no datos ficticios.

PDF usa el renderizador de servidor ya empleado para documentos financieros cuando su licencia y capacidades sean compatibles; XLSX usa un escritor OpenXML real con fórmulas desactivadas/escapadas para cualquier texto controlado por usuarios. No se cambia la extensión de CSV a `.xlsx`. El endpoint registra auditoría de exportación con tipo, filtros normalizados y conteo, sin nombres, observaciones privadas ni bytes del archivo. Las respuestas llevan `no-store`, `nosniff` y nombre de archivo acotado; nunca se publica un objeto de Garage ni una URL de descarga anónima. Si la generación falla, se elimina el buffer temporal y se devuelve error sin archivo corrupto.

La vista previa y la exportación pueden diferir si hubo cambios entre dos solicitudes; ambas muestran su `asOf`. Dentro de cada exportación, filas y metadatos provienen del mismo snapshot. El servidor lee a lo sumo 5 001 filas para decidir si excede el límite y no mantiene una transacción abierta mientras renderiza el archivo.

## Pruebas y entrega

Pruebas de política/persistencia cubren los cuatro filtros, paginación estable, 30/31 fechas, estación y rol revocados, conjunto vacío, más de 100 filas y 5 000/5 001 filas. API y cliente comprueban 401/403/404/422, OpenAPI, encabezados privados y que ningún texto de otra estación aparece. Se abren PDF y XLSX con lectores independientes y se comparan sus filas con el snapshot filtrado; una celda que empieza por `=`, `+`, `-` o `@` queda como texto inerte. La interfaz se prueba con respuestas reales del cliente compartido, cambios concurrentes, reconexión y retirada de datos al perder autorización.

Se entrega mediante PR compatible y CI; DB antes de API antes de AVIAM Web si hay migración. El operador verifica manifiestos y salud del VPS sin editar host. Un recorrido Playwright con cuenta G.H. en Development compara vista previa y ambos archivos para un conjunto sintético multipágina. La nota del Vault y el README distinguen lo implementado de lo que permanece fuera: avisos, tiempo extra, firmas y checklist.
