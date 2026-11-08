# ADR-0035: Facturación directa desde operaciones con factura e-CF simulada

## Estado

Accepted — 2026-11-05.

## Contexto

Fase 4 «Facturación», bloque 1.

Hasta la fase 3 Finanzas llegaba a la factura por un camino largo:
1. Armaba una **prefactura** con los servicios aprobados.
2. La enviaba a la aerolínea, que la aceptaba o la disputaba.
3. Emitía una factura «no fiscal» (`NF-…`) sin impuestos.

Erick pidió eliminar la prefactura y facturar directamente las operaciones completadas con una factura real simulada, «sin complicarnos mucho».

## Decisión

**1. La prefactura sale del producto, no de la base.**
- Las facturas siguen colgando de una prefactura (`non_fiscal_invoices.preinvoice_id`, obligatoria y única). La valoración (paquetes, mínimos, recargos) y la protección contra doble facturación (índice filtrado de `preinvoice_lines.operation_service_id`) viven en sus líneas.
- La emisión las reutiliza como **paso interno de una sola transacción serializable**: crea el borrador, aplica el ITBIS, lo marca aceptado y emite la factura. Nunca queda una prefactura visible ni pendiente.
- **Este bloque** retira de la interfaz «Pre-facturación» y «Servicios aprobados» (private-web) y la aceptación y disputa del portal. Los endpoints de envío, aceptación, disputa y resolución, sus permisos y su código se borran en el **bloque 3**, junto con los demás módulos sin uso.

**2. Factura e-CF simulada (tipo 31, crédito fiscal).**
- Columnas nuevas en `commercial.non_fiscal_invoices` (migración aditiva `AddSimulatedEcfInvoices`):
  - `fiscal_number`: e-NCF `E31` + 10 dígitos, único (índice filtrado), consecutivo; se asigna bajo `UPDLOCK, HOLDLOCK` dentro de la transacción;
  - `security_code`: 6 caracteres derivados de SHA-256 del e-NCF, el total, la firma y el cliente;
  - `fiscal_signed_at`.
  Un check exige las tres juntas o ninguna. El número interno `NF-…` se conserva.
- **ITBIS 18 %** fijo (`FinanceInvoicePolicy`) sobre el neto de cada servicio y recargo, redondeado a centavos. Sustituye a los tratamientos tributarios configurables, que se retiran en el bloque 3.
- **PDF** con formato de factura de crédito fiscal: emisor AVIAM con RNC simulado, cliente, estación, e-NCF, código de seguridad, emisión y vencimiento, líneas con neto, ITBIS y total, QR de consulta simulado y la leyenda **«Simulación — sin validez fiscal»**. Nada se transmite a la DGII.

**3. Emisión.**
- `POST finance/invoices/from-operations { stationId, operationIds[1..100], requestId }`, permiso `finance.invoicing.issue` (módulo nuevo «Facturación»).
- Reglas:
  - todas las operaciones deben estar aprobadas por OCC (`409`, motivo `operation_not_approved`);
  - de **una sola aerolínea** (`422`, `mixed_airline`);
  - con al menos un servicio completado (`422`, `nothing_to_invoice`);
  - sin facturar antes (`409`, `already_invoiced`).
- El mismo `requestId` devuelve la factura ya emitida (`200`, `replayed`); la primera vez responde `201`.
- El motivo llega en `reasons` de Problem Details.

> **Actualización (8 de noviembre de 2026).** «Servicio completado» es ahora un servicio facturable (`ServiceBillability`): completado o en excepción, con cantidad ejecutada, que OCC no excluyó en la revisión. «Por facturar», el borrador interno y la emisión bloquean con `charge_excluded_by_contract` un servicio que lleva un cargo que su contrato excluye, hasta que OCC reabra la revisión y lo quite. Ver [ADR-0039](0039-operation-planning-coverage-offline-tablet-occ-review-and-reports.md).

**4. Charter.** Si la escala tiene un `CharterAgreement` con el prepago **confirmado** en la moneda de la factura, al emitir se registra un cobro (`PREPAGO {referencia}`) por el monto prepagado y se aplica a la factura hasta su total. Lo que sobre queda disponible como saldo a favor; lo que falte se paga después (bloque 2).

**5. Avisos.** Correo «Factura emitida» a las cuentas activas del portal de la aerolínea y a su correo de facturación, con el PDF adjunto (se genera al enviar, `invoice:{id}`). Tiempo real: `airline_treasury`, `finance_approved_services` y `finance_receipts`.

**6. Lecturas por id de factura.**
- `GET finance/invoices/{invoiceId}/document` y `GET airline/portal/invoices/{invoiceId}/document` (PDF).
- La lista y el detalle de facturas de Finanzas y del portal incluyen `fiscalNumber`.

**Clientes**
- private-web: menú «Facturación» con **Por facturar** (operaciones aprobadas sin facturar, agrupadas por operación, con atajos de semana de domingo a sábado y de mes; solo se combinan operaciones de la misma aerolínea y moneda; estimado de subtotal, ITBIS y total) y **Facturas** (e-NCF y PDF).
- Portal: «Finanzas» pasa a «Facturas» (estado Pendiente, Vencida o Pagada, vencimiento, saldo, detalle y PDF). «Documentos» lista los PDF por factura y «Reportes» muestra facturas en vez de prefacturas.

## Consecuencias

- Finanzas factura en un paso lo que OCC aprobó; no hay prefacturas ni disputas que esperar.
- Un error de facturación se corrige con una nota de crédito fuera del flujo (no hay reclamos en el sistema).
- La factura tiene aspecto de e-CF pero ningún valor fiscal: cada documento lo dice.

**Queda fuera de este bloque**
- **Pago con tarjeta** desde el portal (bloque 2).
- **Borrado** del código, endpoints y permisos de prefactura, y simplificación del resto de Finanzas (bloque 3).
- **RNC real de AVIAM y del cliente.** El emisor usa un RNC simulado y el cliente su razón social; el modelo comercial no guarda aún RNC revisados.
