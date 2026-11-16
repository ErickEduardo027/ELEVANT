# ADR-0032: Formularios AVIAM firmados en la tablet y walk-around con foto

## Estado

Accepted — 2026-11-04.

## Contexto

Fase 3 del ciclo operativo, bloque 4: formularios, firmas, PDF y fotos del walk-around.

**El problema de hoy.** Tras la operación, el agente vuelve a escribir en papel lo que ya registró, en tres formularios de AVIAM:
- **Orden de Servicio en Rampa** (F-RAM-AVL-MAG 04, rev. 02, 2023). La firma el representante de la aerolínea y vale como factura si paga en efectivo.
- **Reporte de Vuelo** (F-OCC-AVL-6.2.12/A9, rev. 2, junio 2023). Lo firma el coordinador.
- **Check-List y Reporte Diario del Puente** (F-MGO-AVL 8.14.1/A1 y A2, revisión 01, enero 2022). Lo firma el operador.

Un error de matrícula o un cambio de avión obligan a rehacer la Orden y a volver a pedir la firma. Las anomalías del walk-around se marcan con una «X» en una silueta impresa, sin foto.

**Lo que ya existía.**
- Todo lo que llevan los formularios ya estaba en el registro de la operación (ADR-0031): vuelos, matrícula, pasajeros, MTOW, hitos, checklist, servicios, recargos y desviaciones con código IATA.
- Los contratos ya se firman contra la huella SHA-256 de su contenido canónico (ADR-0025).

## Decisión

**1. Los formularios se generan, no se escriben.**
- `OperationDocumentAssembler` arma el contenido de cada formulario desde el registro único de la operación.
- **Orden de Servicio:** datos del vuelo, servicios con cantidad ejecutada × precio del contrato, recargos aplicados, total y tipo de factura.
- **Reporte de Vuelo:** checklist de llegada y retroempuje, los tiempos de «Operación en posición», los daños marcados, las demoras IATA y las observaciones.
- **Check-List del Puente:** se genera solo si la operación tiene el checklist del puente.
- El contenido es determinista. Su JSON canónico es lo que se hashea, se firma y se dibuja.
- Las tres hojas comparten un número: código de estación + id interno de la operación con 9 dígitos (`PUJ000000123`). No hace falta secuencia ni escribir al leer.

**2. Firma contra la huella exacta.**
- La tablet muestra al firmante los datos facturables y la huella, y envía la firma con el SHA-256 que vio.
- El servidor recalcula el contenido. Si la huella no coincide, responde 409: el formulario cambió y hay que releerlo.
- Solo se guarda la versión que se firma, en `ops.operation_document_versions`, inmutable y única por (operación, formulario, huella).
- Las firmas viven en `ops.operation_document_signatures`: son de solo inserción, admiten una por rol y versión y son idempotentes por dispositivo.
- **Firmantes por formulario:**
  - Orden de Servicio: representante de la aerolínea y AVIAM.
  - Reporte de Vuelo: coordinador.
  - Puente: operador.
- **«Si cambia un dato facturable, se pide la firma otra vez, y solo esa».** El cambio da otra huella. Ese formulario muestra los roles que firmaron la versión anterior como «firmar de nuevo», y los demás formularios conservan sus firmas.
- **Trazos, no imagen.** La firma se guarda como trazos de puntos normalizados (0–1) sobre un pad 3:1, con su propio SHA-256. PDFsharp la dibuja como líneas a cualquier tamaño. La tablet no necesita canvas ni PNG: solo `react-native-svg`, incluido en Expo Go.

**3. PDF fieles al papel.**
- `OperationDocumentPdfRenderer` (PDFsharp, Noto Sans embebida) reproduce las secciones, los textos, los códigos y las revisiones de cada formulario. Incluye las cláusulas literales de la Orden de Servicio (Acuerdo Estándar IATA, recargos del 15 % y factura en efectivo).
- La silueta del avión (`AircraftSilhouette`) se define una sola vez, con las mismas coordenadas en la tablet y en el PDF.
- El pie lleva el código y la revisión del formulario, la página y el SHA-256 del contenido firmado.
- Los PDF se generan al pedirlos; no se archivan.

**4. Walk-around 360° con foto.**
- El agente toca la silueta, escribe qué encontró y toma una foto.
- La marca (`ops.operation_damage_marks`) lleva un id generado en la tablet, así que la foto puede enlazarse aun sin señal.
- La foto (JPEG o PNG, como máximo 6 MB, verificada por sus primeros bytes) va a un almacenamiento S3 privado con su SHA-256. Se admite una por marca: los mismos bytes otra vez son un reintento y otros bytes, un conflicto.
- Si el almacenamiento no está configurado o falla, se responde 503 y la tablet reintenta más tarde.
- Las fotos no entran en la huella, porque llegan después de firmar. Se anexan al PDF del Reporte de Vuelo en una página aparte.

**5. Sin conexión, en la misma cola.**
- Firmas, marcas y fotos viajan en la cola persistente del Reporte de Vuelo (ADR-0031), en orden. La foto siempre va detrás de su marca.
- La foto se copia a la carpeta de documentos de la app y se borra solo cuando ELEVANT la confirma.
- Una firma rechazada porque el formulario cambió queda en «Sincronización» para firmar de nuevo, sin reintento a ciegas.

**6. Quién ve qué.**
- **Tablet:** el agente asignado firma y marca daños, con `operations.ramp`.
- **OCC:** consulta los formularios de las operaciones de su estación y descarga los PDF y las fotos desde la revisión, con `operations.review.read`.
- **Portal de la aerolínea:** solo ve, filtrada por su organización, la última Orden de Servicio firmada por completo, dibujada desde la versión guardada.

> **Actualización (8 de noviembre de 2026).** Los recargos automáticos se proyectan en la Orden de Servicio antes de la firma, y OCC solo aprueba una Orden firmada sobre su contenido actual o corregida por OCC (`service_order_unsigned`, `service_order_stale`). Un ajuste de cargos o una exclusión de facturación que OCC hace después de la firma guarda una versión corregida con su motivo (`corrects_version_id`): el PDF la imprime como «Corregida por OCC después de la firma» y la aerolínea recibe esa versión en su portal. La revisión de OCC lista las marcas del walk-around con su nota y su hora local y abre la foto bajo demanda desde `GET occ/operations/{id}/damage-marks/{markId}/photo`. Ver [ADR-0039](0039-operation-planning-coverage-offline-tablet-occ-review-and-reports.md).

**Endpoints**

| Ruta | Para qué |
|---|---|
| `GET ramp/operations/{id}/documents` | El agente lee los formularios |
| `PUT …/documents/{kind}/signatures/{role}` | Firmar un formulario |
| `PUT …/damage-marks/{markId}` | Marcar un daño |
| `PUT …/damage-marks/{markId}/photo` | Adjuntar la foto de un daño |
| `GET occ/operations/{id}/documents` | OCC lee los formularios |
| `GET occ/operations/{id}/documents/{kind}/pdf` | OCC descarga el PDF |
| `GET occ/operations/{id}/damage-marks/{markId}/photo` | OCC ve la foto |
| `GET airline/portal/operations/{id}/service-order` | La aerolínea ve su Orden firmada |
| `GET airline/portal/operations/{id}/service-order/pdf` | La aerolínea descarga el PDF |

## Consecuencias

- El agente ya no transcribe: lo capturado en la operación llena los tres formularios.
- Corregir la matrícula o los pasajeros pide de nuevo solo las firmas de la Orden de Servicio.
- La aerolínea recibe la Orden firmada en su portal.

**Queda fuera de este bloque**
- **Formulario de charter sin contrato.** El «Formulario de solicitud de servicio y descargo de responsabilidad» no está entre los formularios recibidos, y su texto legal no se inventa. Queda pendiente hasta tener el formulario literal de AVIAM. Mientras tanto, la Orden de Servicio se emite siempre como «A Crédito» y «Vuelo Regular». *Resuelto después en [ADR-0033](0033-charter-flights-without-contract.md).*
- **Valoración de recargos.** La Orden lista los recargos aplicados, pero no los valora: eso es el cierre OCC → Finanzas del bloque 5. El total cubre solo los servicios con precio del contrato.
- **Check-List del Puente.** Se firma una vez por operación, no por fase. El pre-uso y la llave recibida o entregada siguen dentro del checklist del vuelo, hasta que la cobertura por turno los registre.
- **Checklist del Reporte de Vuelo en posiciones con puente.** Esas operaciones materializan el checklist del puente (ADR-0031), así que su Reporte de Vuelo muestra «sin respuestas» en llegada y retroempuje.
