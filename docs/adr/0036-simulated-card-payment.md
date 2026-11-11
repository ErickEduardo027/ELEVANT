# ADR-0036: Pago simulado con tarjeta desde el portal de aerolíneas

## Estado

Accepted — 2026-11-05.

## Contexto

Fase 4 «Facturación», bloque 2. Desde [ADR-0035](0035-direct-invoicing-simulated-ecf.md) Finanzas emite facturas e-CF simuladas, pero la aerolínea no tenía cómo pagarlas: los cobros se registraban a mano en tesorería.

Erick pidió que la aerolínea pague en el portal con una tarjeta simulada y con tarjetas de prueba (unas se aprueban, otras se rechazan y otras piden reintento), siempre por el **total** de la factura.

## Decisión

**1. Pasarela simulada.**
- `ICardPaymentGateway` (Application) con `SimulatedCardGateway` (Infrastructure). Es determinista, no hace llamadas de red y no guarda nada.
- Antes de la pasarela, `CardPaymentPolicy` valida el titular, el número (Luhn), el vencimiento (válido hasta el último día del mes), el código de seguridad (3 dígitos, 4 en Amex) y el monto. Los motivos de rechazo viajan en `reasons` de Problem Details.
- Tarjetas de prueba:

  | Tarjeta | Resultado |
  |---|---|
  | 4111 1111 1111 1111 (Visa), 5555 5555 5555 4444 (Mastercard) | Aprobada |
  | 4000 0000 0000 0002 | Rechazada: `insufficient_funds` |
  | 4000 0000 0000 0069 | Rechazada: `expired_card` |
  | 4000 0000 0000 0119 | Error del procesador: `processing_error` (se reintenta) |
  | Cualquier otra con Luhn válido | Rechazada: `card_not_accepted` |

> **Actualización (10 de noviembre de 2026).** La pasarela se elige con `CardPayments:Mode`: `Disabled` por defecto y en `appsettings.Production.json`, o `Simulated`, que solo arranca en los entornos `Development`, `Test` o `Testing`; en otro, la API no inicia. Sin pasarela, `GET airline/portal/card-payments/availability` lo dice, el portal muestra el pago como no disponible y `POST …/card-payments` responde `409 card_payments_unavailable` antes de mirar la tarjeta. Ver [ADR-0040](0040-billing-cycle-invoicing-from-operations-card-collections-credit-notes-and-payables.md).

**2. Pago del total.**
- `POST airline/portal/invoices/{invoiceId}/card-payments` con `Idempotency-Key`. El cuerpo lleva titular, número, vencimiento, CVV y monto.
- Solo se pagan facturas de la aerolínea de la cuenta (`AIRLINE_CLIENT`). El monto debe ser el **saldo completo**; si no, responde `409 amount_mismatch`. Una factura saldada da `409 invoice_paid`.
- Una sola transacción serializable registra el intento en `commercial.card_payment_attempts` y, si se aprueba:
  - crea un cobro de tesorería con método **`Card`** (`PaymentMethod.Card`, nuevo) aplicado a la factura, con referencia `TARJETA VISA *1111 AUT …`;
  - audita `finance.card_payment.approved`, o `declined`/`error` en los demás casos;
  - encola el correo **«Pago recibido»** a la cuenta que pagó, con el recibo PDF adjunto (`card-receipt:{id}`);
  - avisa a Finanzas (`invoice_paid`, permiso `finance.reconciliation.read`, filtrado por estación);
  - anuncia `airline_treasury` y `finance_receipts` en tiempo real.
- Un rechazo o un error del procesador también se guarda como intento; la factura sigue pendiente.
- **Idempotencia:** la misma clave con el mismo cuerpo devuelve el intento guardado (`200`, `replayed`). Con otro cuerpo responde `409 idempotency_conflict`. La huella del cuerpo es SHA-256 de la factura, el monto, la marca y los últimos 4 dígitos, nunca del número completo.
- El portal reintenta un resultado incierto (de red) con la misma clave. Tras un rechazo, o para otra tarjeta, usa una clave nueva.
- Finanzas no puede registrar a mano un cobro `Card`.

> **Actualización (10 de noviembre de 2026).** Tesorería tampoco revierte ni devuelve un cobro `Card` (`409 card_payment_not_reversible`): se corrige con una nota de crédito, que sobre una factura E31 lleva su e-NCF `E34`. Toda negativa del pago, salvo el `401`, lleva `code` además de los `reasons`. El portal de un charter paga así el resto de su factura. Ver [ADR-0040](0040-billing-cycle-invoicing-from-operations-card-collections-credit-notes-and-payables.md).

**3. Datos de tarjeta.** Solo se guardan la **marca, los últimos 4 dígitos**, el estado, el código de rechazo y la autorización. Nunca el número completo, el CVV ni el nombre del titular, ni en la base ni en la auditoría ni en los correos (lo comprueba la prueba de integración). En producción se usaría el formulario tokenizado de un proveedor de pagos.

**4. Lecturas.**
- `GET airline/portal/invoices/{invoiceId}/card-payments` y `GET finance/invoices/{invoiceId}/card-payments`: historial de intentos.
- `GET airline/portal/card-payments/{attemptId}/receipt`: recibo PDF de un pago aprobado.

**Clientes**
- **Portal:** «Facturas › detalle» trae el panel **Pagar con tarjeta** con el saldo fijo. Muestra el resultado (aprobada, rechazada o reintentar), el historial de intentos y la descarga del recibo.
- **private-web:** el detalle de «Facturas» muestra los pagos con tarjeta (marca •••• últimos 4, autorización o motivo). Tesorería muestra el método «Tarjeta», pero no lo ofrece en el registro manual, y la campana avisa «La aerolínea pagó una factura con tarjeta».
- Las tarjetas de prueba se entregaron a Erick en `tarjetas-de-prueba-elevant.txt`, en su escritorio, fuera del repositorio.

## Consecuencias

- La aerolínea cierra el ciclo sola: ve la factura, la paga y recibe su recibo. Finanzas no registra ese cobro.
- Un pago rechazado deja rastro auditable sin datos sensibles.
- La simulación autoriza dentro de la transacción. Una pasarela real autorizaría fuera, con un intento pendiente y una confirmación posterior (webhook); no se implementa.

**Queda fuera**
- Pagos parciales, reembolsos y contracargos con tarjeta.
- Proveedor real de pagos, 3-D Secure y tokenización.
