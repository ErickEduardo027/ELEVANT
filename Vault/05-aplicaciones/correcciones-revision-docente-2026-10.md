---
id: aplicaciones-correcciones-revision-docente-2026-10
title: "Correcciones de la revisión docente de octubre de 2026"
type: status
area: applications
status: documented
maturity: evolving
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-10-26"
verified_commit: "e49e58d39b3eae80bd0184581d9231268ef55f7b"
sources:
  - docs/adr/0019-menu-option-permissions-and-department-notifications.md
  - backend/Elevant.Domain/Validation/PhoneNumbers.cs
  - backend/Elevant.Domain/Validation/IdentityDocuments.cs
  - backend/Elevant.Domain/Validation/AirlineCodes.cs
  - backend/Elevant.Domain/Reference/DominicanTerritory.cs
  - scripts/geo/generate-do-territory.mjs
  - backend/Elevant.Application/Commercial/CommercialCatalogPublication.cs
  - backend/Elevant.Domain/Governance/DepartmentPermissionCatalog.cs
  - database/DevelopmentDB/Elevant.Persistence/Identity/DepartmentNotificationWriter.cs
  - backend/Elevant.Api/Controllers/DepartmentNotificationsController.cs
  - backend/Elevant.Api/Controllers/OccReportsController.cs
  - database/DevelopmentDB/Elevant.Persistence/Operations/EfOccReportStore.cs
  - backend/Elevant.Api/Controllers/ContractDocumentsController.cs
  - backend/Elevant.Infrastructure/Commercial/ContractPdfRenderer.cs
  - frontend/public-web/src/components/portal/ContractPdfActions.tsx
  - frontend/private-web/src/features/contracts/agreements/ContractPdfButtons.jsx
  - database/DevelopmentDB/Elevant.Persistence/Commercial/EfContractDocumentStore.cs
  - backend/Elevant.Infrastructure/Commercial/ContractPdfRenderer.cs
  - backend/Elevant.Api/Controllers/OccPositionsController.cs
  - database/DevelopmentDB/Elevant.Persistence/Operations/EfOccPositionStore.cs
  - frontend/private-web/src/features/department-users/PermissionMatrix.jsx
  - frontend/private-web/src/features/notifications/DepartmentNotificationCenter.jsx
  - frontend/private-web/src/features/reports/CanonicalReportsRoute.jsx
  - frontend/private-web/src/features/positions-map/components/PositionActions.jsx
  - frontend/private-web/src/features/dashboard/useDashboardData.js
  - frontend/public-web/src/components/portal/AirlineContractSignature.tsx
tags:
  - revision-docente
  - validaciones
  - permisos
  - notificaciones
  - reportes
  - contratos
  - mapa-de-posiciones
---

# Correcciones de la revisión docente de octubre de 2026

En la revisión del 19-oct-2026 (min 38–93 de la grabación), el profesor anotó
16 puntos. El equipo añadió un punto 17: mover el catálogo comercial a
Contratos. Esta nota resume qué cambió y dónde verlo.

**Fuera de alcance:** el envío de contratos por correo electrónico; queda en
[pendientes](../12-backlog/pendientes-transversales.md). Nada de esto está
desplegado hasta que se fusione el PR hacia `Development` y el operador lo
publique.

## Validaciones y datos de referencia

| Punto | Comportamiento actual |
| --- | --- |
| Teléfono | Se acepta `849-246-3371`, `(809) 555 0100` o `+1 849…`, y se guarda en E.164 (`+18492463371`). Un número internacional exige `+` o `00`. Mismo resultado en la API, en el cliente compartido y en los formularios. |
| Documentos | Cada tipo tiene su propia regla: <ul><li>**Cédula:** 11 dígitos con dígito verificador (Luhn).</li><li>**Pasaporte dominicano:** 2 letras y 7 dígitos.</li><li>**Pasaporte extranjero:** 6 a 9 caracteres alfanuméricos.</li><li>**Residencia:** formato de cédula.</li><li>**RNC:** 9 dígitos con módulo 11.</li></ul>Cada error explica el formato esperado con un ejemplo. Lo ya guardado no se vuelve a validar.<br>En la solicitud de acceso de Public Web, la cédula se formatea como `###-#######-#` mientras se escribe. Debajo del número, una lista de requisitos (`identityDocumentRequirements` del cliente compartido, con las mismas reglas) pasa cada punto a verde al cumplirse. |
| Mensajes | Los formularios de Private Web y Public Web muestran sus propios mensajes en español, debajo de cada campo, en lugar de las burbujas del navegador. |
| Geografía | Las 32 provincias, 158 municipios y 238 distritos municipales salen del XSD e-CF de la DGII, con los ajustes de la ONE de 2021 (`scripts/geo/generate-do-territory.mjs`). La API rechaza un municipio que no pertenece a su provincia. Ejemplo: El Seibo → Miches, con Pedro Sánchez como distrito de El Seibo. |
| Aerolínea real | Los códigos IATA y ICAO se validan contra los códigos reservados y de prueba. Dos aerolíneas verificadas no pueden compartir código: hay índices únicos filtrados. |

## Catálogo, imágenes y unidades de cobro

- **Catálogo en Contratos.** El catálogo comercial se gestiona en Contratos
  (Servicios). Finanzas lo lee para tarifar, pero ya no lo edita.
- **Publicación.** Para publicar un servicio se exige una foto, una descripción
  de al menos 20 caracteres y un nombre que no sea de prueba.
- **Imágenes de reserva.** Si un servicio no tiene foto, o la foto no carga, se
  muestra una ilustración según el tipo de servicio.
- **Paginación.** El asistente público pagina los servicios de 6 en 6.
- **Unidades de cobro.** Finanzas tiene la opción «Unidades de cobro» (lista,
  crear y editar), y el catálogo solo ofrece unidades activas. La demora se
  cobra con el cargo DELAY; la unidad solo dice cómo se mide (ver el
  [glosario](../03-dominio/glosario-canonico.md)).

## Permisos y notificaciones

Ver [ADR-0019](../../docs/adr/0019-menu-option-permissions-and-department-notifications.md)
y [Gobernanza por departamento](../03-dominio/gobernanza-por-departamento.md).

- **Permisos.** La matriz tiene una fila por opción del menú, con las columnas
  Ver, Crear, Modificar, Eliminar y Otras acciones. Cada botón y cada endpoint
  exige su propia acción.
- **Notificaciones.** Gestión Humana, Contratos y Finanzas tienen campana, aviso
  en pantalla con «Abrir» y un cajón con las últimas alertas. Gestión Humana ya
  no usa el feed del prototipo.

## Reportes OCC

Hay cinco reportes generados en la API, con exportación a Excel, PDF y CSV
(UTF-8 con BOM):

- operaciones del período;
- tiempos de turnaround;
- servicios ejecutados por aerolínea;
- revisiones, devoluciones e incidencias;
- productividad por agente.

Ver un reporte exige `operations.reports.read`; exportarlo exige además
`export`, y cada exportación queda auditada. El período máximo es de un año y
cada exportación admite hasta 5 000 filas.

## Contratos: detalle, PDF y firma

- **Detalle.** «Contratos» abre el detalle de cada versión aprobada: partes,
  vigencia, estaciones, tarifas y términos. Desde ahí se descarga el PDF formal,
  generado en la API.
- **Firmas.** Firman las dos partes:
  - AVIAM, con `contracts.agreements.sign`;
  - la aerolínea, desde su portal.

  Cada firma guarda el nombre, el cargo, la fecha y la huella SHA-256 del
  contenido. Una huella desactualizada se rechaza. `commercial.contract_signatures`
  es de solo inserción.
- **Contrato firmado.** Cuando firma la segunda parte, el contrato registra
  `SignedOn`. Desde noviembre de 2026 la segunda firma, con la aprobación de
  Finanzas y un permiso de operación verificado, es también lo que activa el
  contrato ([ADR-0024](../../docs/adr/0024-airline-permits-and-contract-lifecycle.md)).
- **Origen.** Todo contrato nace de una solicitud aprobada. La pantalla lo
  explica y lleva a Solicitudes.
- **Formato de impresión (segunda ronda, noviembre de 2026).** `ContractPdfRenderer`
  produce el mismo diseño para el borrador y para la versión final:
  - cabecera con el logo de ELEVANT, el código del contrato y el estado de la
    versión;
  - partes en dos columnas y tarjetas de vigencia, moneda, estaciones y
    servicios;
  - tarifas con filas alternas y precios alineados a la derecha;
  - términos numerados como cláusulas (4.1, 4.2…);
  - cajas de firma con su estado y la huella SHA-256;
  - pie con «Página X de Y» y la fecha de generación.

  Usa Noto Sans Regular y Bold incrustadas completas, porque el subconjunto de
  PdfSharp perdía las tildes.
- **PDF del borrador.** `GET contract-versions/{id}/draft/pdf` sirve las versiones
  en borrador o en revisión de Finanzas a Contratos y a la aerolínea dueña. Lleva
  la marca de agua «BORRADOR · NO VÁLIDO PARA FIRMA», muestra las tarifas sin
  confirmar como «Por definir» y no incluye bloque de firma. Ese campo no entra
  en la huella firmada.
- **Descargar e imprimir.** El portal (borrador y contrato final) y Contratos en
  Private Web (detalle y borradores) ofrecen «Descargar PDF» e «Imprimir».
  Imprimir abre el mismo PDF en un marco oculto, así que el papel conserva el
  diseño oficial; la vista web del portal tiene además una hoja `@media print`.

## Mapa de posiciones y panorama OCC

- **Ocupación real.** El mapa de PUJ muestra cada posición como libre,
  planificada u ocupada. Ocupada significa que la aeronave de su asignación
  activa ya llegó.
- **Acciones del OCC** (`operations.positions_map.assign`):
  - registrar la llegada (matrícula y hora);
  - asignar o reasignar la posición: se rechaza si se solapa con otra;
  - liberarla.

  Cada cambio se audita y se anuncia en tiempo real.
- **Panorama.** Si el panorama no responde en 20 s, la pantalla avisa y ofrece
  reintentar. Las señales del feed ya no reinician una lectura en curso; antes,
  eso lo dejaba en «Cargando panorama operativo…».
- **Límite:** las posiciones combinadas (9-Alfa, 32-Bravo) siguen sin modelarse
  en la base de datos.

## Relacionados

- [Private Web / AVIAM](private-web-aviam.md)
- [Public Web y portal de aerolíneas](public-web-portal.md)
- [Solicitudes, contratos y servicios](../03-dominio/solicitudes-contratos-y-servicios.md)
- [Finanzas](../03-dominio/finanzas-tarifas-cargos-y-cobros.md)
- [Turnaround y operación](../03-dominio/turnaround-y-operacion.md)
