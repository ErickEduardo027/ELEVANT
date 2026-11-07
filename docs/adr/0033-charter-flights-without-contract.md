# ADR-0033: Vuelos charter sin contrato con Solicitud de Servicio firmada y prepago

## Estado

Accepted — 2026-11-04.

## Contexto

Fase 3 del ciclo operativo, bloque 4b.

**El problema.** Una aerolínea sin contrato con AVIAM (un charter) no puede asignarse hoy:
- la planificación de OCC exige un contrato vigente y sus servicios;
- el alta manual exige exactamente un contrato aplicable.

En el papel, AVIAM usa el «Formulario de Solicitud de Servicio y Descargo de Responsabilidad». Ese formulario hace de contrato del vuelo. Lo llenan:
- el agente, con los servicios a la tarifa estándar de Finanzas;
- el representante del transportista, con su dirección y quién paga los cargos. Firma con su cédula o pasaporte y paga por adelantado.

**De dónde sale el texto.** Del formulario no había PDF. La página 1 se transcribió literalmente de una grabación de la reunión con OCC (minuto 1:05:00–1:05:36). Esa página trae:
- encabezado bilingüe;
- datos del vuelo, llegada y salida;
- 14 servicios con casilla, más «Otro»;
- declaración en español e inglés;
- firmas con nombre, cédula o pasaporte y sello.

Las páginas 2 y 3 son los términos del Acuerdo Estándar de Servicios en Tierra IATA 2018 con las modificaciones de AVIAM. Su texto no se ve en la grabación.

## Decisión

**1. Un charter es un acuerdo del vuelo, no un contrato.**
- `ops.charter_agreements` tiene una fila por escala (única por `turnaround_id`) con:
  - la aerolínea;
  - la moneda (USD);
  - la dirección del transportista y quién paga;
  - el estado del prepago (`Pending`/`Confirmed`), con monto, referencia, fecha y cuenta de Finanzas.
- El check de la tabla obliga a que un prepago confirmado tenga monto, referencia, fecha y cuenta.
- Un charter nunca tiene contrato. Una aerolínea con contrato aplicable no puede darse de alta como charter (409).

**2. OCC lo registra y lo asigna.**
- El alta manual tiene un interruptor «Vuelo charter». Ofrece solo las aerolíneas activas sin contrato (`charterAirlines`).
- La escala queda sin `contract_version_id` y con su `charter_agreement`.
- Las opciones de planificación indican `isCharter`. OCC asigna sin contrato ni servicios previos.
- El checklist se elige igual que para cualquier vuelo: el del puente si la posición tiene puente y, si no, el del Reporte de Vuelo.

> **Actualización (7 de noviembre de 2026).** OCC también da de alta un charter desde el feed de vuelos: la vista «Charter sin contrato» muestra los vuelos de las aerolíneas activas registradas sin un contrato en vigor ese día en la estación, y la importación en modo charter crea la escala con su acuerdo y el prepago `Pending` (`charter_required`, `charter_has_contract`). Ver [ADR-0038](0038-preoperation-contract-lifecycle-permits-master-data-and-workforce-readiness.md).

**3. El agente agrega los servicios en la tablet.**
- `GET ramp/operations/{id}/charter` devuelve el catálogo de definiciones activas con tarifa base, su precio y su mínimo.
- `POST …/charter/services` agrega una línea de servicio. La línea guarda:
  - cantidad contratada = max(cantidad, mínimo);
  - una instantánea del precio unitario y la moneda (`FinanceTariffLookup.ServiceRatesAsync`);
  - `contract_service_rate_id` nulo.

  Se admite una línea por definición.
- `PUT …/charter/details` guarda la dirección del transportista y quién paga los cargos.
- Ambos son comandos móviles idempotentes por dispositivo (`RampReceiptRunner`). Viajan en la cola persistente del Reporte de Vuelo (ADR-0031), así que funcionan sin señal.

**4. La Solicitud de Servicio es un formulario más (ADR-0032).**
- `CharterServiceRequest` se genera desde el registro de la operación. La firman el representante de la aerolínea y AVIAM.
- La Orden de Servicio de un charter sale como «Vuelo Charter» y «Al Contado».
- **Cédula o pasaporte.** Quien firma la Solicitud deja su cédula o pasaporte (4–40 letras, números o guiones). Va en la firma (`signer_identification`) y la API lo acepta solo para este formulario.
  - Es un dato de escritura: no vuelve en ninguna respuesta de la API.
  - Solo aparece en el PDF.
  - La prueba de arquitectura lo trata como una excepción explícita a la regla que prohíbe documentos de identidad en los contratos de Operations.
- **PDF.**
  - La página 1 reproduce literalmente el formulario. Marca los servicios del catálogo por su código y lista los demás en «Otro».
  - La página 2 indica que los términos y condiciones de las páginas 2 y 3 son el Acuerdo Estándar IATA 2018 con las modificaciones de AVIAM, sin reproducir un texto que no tenemos.

**5. Finanzas confirma el prepago.**
- `GET finance/charters` (`finance.charters.read`) lista los charters de las estaciones de la cuenta. Cada uno muestra:
  - el total de los servicios (precio × cantidad ejecutada, o contratada si aún no hay ejecutada);
  - si la Solicitud está firmada por los dos roles en la misma versión.
- `PUT finance/charters/{id}/prepayment` (`finance.charters.confirm`) registra el monto y la referencia.
  - Repetir con los mismos datos es idempotente; con otros datos responde 409.
  - Queda auditado como `finance.charter.prepayment_confirmed`.
- private-web añade el módulo «Charters sin contrato» en Finanzas.

**Endpoints**

| Ruta | Para qué |
|---|---|
| `GET ramp/operations/{id}/charter` | El agente lee el charter y su catálogo |
| `POST ramp/operations/{id}/charter/services` | Agregar un servicio a tarifa base |
| `PUT ramp/operations/{id}/charter/details` | Dirección del transportista y quién paga |
| `GET finance/charters` | Finanzas lista los charters |
| `PUT finance/charters/{id}/prepayment` | Finanzas confirma el prepago |

## Consecuencias

- Un charter se opera con el mismo flujo que un vuelo con contrato: asignación, Reporte de Vuelo, formularios y entrega a OCC.
- Cada dato se escribe una vez: los servicios agregados alimentan la Orden de Servicio, la Solicitud y el total que ve Finanzas.
- La cédula o el pasaporte del firmante se guardan solo para el PDF firmado.

**Queda fuera de este bloque**
- El texto literal de las páginas 2 y 3, hasta tener el formulario de AVIAM.
- La valoración de recargos de un charter y su prefactura, que llegan con el cierre OCC → Finanzas del bloque 5. *Recargos automáticos y cierre: [ADR-0034](0034-operational-close-occ-to-finance.md).*
- Retirar un servicio agregado por error: hoy lo corrige OCC en la revisión.
