---
id: tesoreria-cobros-y-portal
title: "Cobros, aplicaciones y consulta de aerolínea"
type: capability
area: applications
status: verified
maturity: evolving
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-11-10"
verified_commit: "39a85a46ae089239e22edce448a4d77771680b46"
sources:
  - backend/Elevant.Api/Controllers/AirlineTreasuryController.cs
  - backend/Elevant.Api/Controllers/FinanceTreasuryController.cs
  - backend/Elevant.Api/Controllers/CardPaymentsController.cs
  - backend/Elevant.Application/Abstractions/Finance/FinanceTreasuryPortalAccess.cs
  - backend/Elevant.Contracts/Finance/AirlineTreasuryContracts.cs
  - database/DevelopmentDB/Elevant.Persistence/Finance/FinanceTreasuryStore.Portal.cs
  - database/DevelopmentDB/Elevant.Persistence/Finance/FinanceTreasuryStore.Commands.cs
  - database/DevelopmentDB/Elevant.Persistence/Finance/CharterPrepaymentPosting.cs
  - database/DevelopmentDB/Elevant.Persistence/Finance/EfCardPaymentStore.cs
  - database/DevelopmentDB/Elevant.Persistence/Operations/AirlineOperationChangeWriter.cs
  - database/DevelopmentDB/Elevant.Persistence/Realtime/EfAccountChangeReadStore.cs
  - frontend/private-web/src/features/finance/invoices/InvoicesPage.jsx
  - frontend/private-web/src/features/finance/treasury/TreasuryPage.jsx
  - frontend/public-web/src/components/portal/AirlineFinancePage.tsx
  - frontend/public-web/src/components/portal/AirlineTreasuryPanel.tsx
  - frontend/public-web/src/components/portal/CardPaymentPanel.tsx
  - frontend/public-web/src/components/portal/useLiveSnapshot.ts
  - frontend/public-web/src/components/portal/LiveSnapshotNotice.tsx
  - frontend/public-web/src/components/auth/AirlineSessionProvider.tsx
  - backend/tests/Elevant.IntegrationTests/Persistence/SqlServerMigrationTests.FinanceTreasuryPortal.cs
  - backend/tests/Elevant.IntegrationTests/Persistence/SqlServerMigrationTests.FinanceTreasury.cs
  - backend/tests/Elevant.IntegrationTests/Persistence/SqlServerMigrationTests.FinanceTreasuryCompatibility.cs
  - backend/tests/Elevant.IntegrationTests/Persistence/SqlServerMigrationTests.FinanceInvoiceChanges.cs
  - backend/tests/Elevant.IntegrationTests/Persistence/SqlServerMigrationTests.CharterPrepayment.cs
  - frontend/public-web/tests/unit/airline-treasury-panel.test.tsx
  - docs/adr/0035-direct-invoicing-simulated-ecf.md
  - docs/adr/0036-simulated-card-payment.md
tags:
  - finanzas
  - cobros
  - aerolineas
---

# Cobros, aplicaciones y consulta de aerolínea

Esta nota describe el código del commit verificado, con la fase 4 del ciclo. No
acredita merge en otra rama, despliegue ni aceptación operativa. Las reglas de
facturación, notas y tarjeta están en
[Finanzas](../03-dominio/finanzas-tarifas-cargos-y-cobros.md).

## De dónde nace un cobro

| Origen | Cómo se registra | Corrección |
| --- | --- | --- |
| Pago con tarjeta del portal | La aerolínea paga el saldo completo de su factura ([ADR-0036](../../docs/adr/0036-simulated-card-payment.md)); el cobro `Card` queda aplicado a esa factura | No se revierte ni se devuelve (`card_payment_not_reversible`): se emite una nota de crédito |
| Prepago de un charter | El cobro `PREPAGO {referencia}` se registra al emitir la factura o al confirmar el prepago después, y se aplica una sola vez hasta el saldo ([prepago](../../database/DevelopmentDB/Elevant.Persistence/Finance/CharterPrepaymentPosting.cs)) | El excedente queda como saldo a favor; un prepago ya aplicado se revierte en Cobros antes de reabrirlo |
| Registro de Finanzas | En «Facturas → Cobros», `POST finance/receipts` con transferencia, cheque, efectivo u otro (`finance.receipts.create`) | Reverso de la aplicación o del cobro y devolución del remanente, cada uno con su permiso |

El pago manual completo de prueba de la factura no fiscal (`POST finance/payments`)
se retiró en la fase 4 y responde `410 legacy_finance_route_retired`; su
registro heredado se sigue leyendo por la factura.

## Factura y cobro en Private Web

«Facturas» ([vista](../../frontend/private-web/src/features/finance/invoices/InvoicesPage.jsx))
lista las facturas por e-NCF, con saldo, estado y PDF, y lleva las pestañas
«Cobros» y «Estados de cuenta» según los permisos de la cuenta. El detalle
monta las notas por línea y abre un cobro mediante
`onOpenReceipt(receiptId, contextoFactura)`; la gestión sin cobro seleccionado
usa un identificador nulo y una aplicación abre el identificador real del cobro.

Un cobro puede quedar sin aplicar, cubrir parcialmente una factura o
repartirse. Revertir una aplicación, revertir un cobro y devolver remanente son
movimientos distintos ([comandos](../../database/DevelopmentDB/Elevant.Persistence/Finance/FinanceTreasuryStore.Commands.cs)).
Una aplicación anterior al día hábil de emisión de la factura responde
`effective_before_invoice` y un movimiento anterior a su cobro,
`effective_before_receipt`. Un cobro con tarjeta muestra que se corrige con una
nota de crédito y no ofrece revertir ni devolver
([Cobros](../../frontend/private-web/src/features/finance/treasury/TreasuryPage.jsx)).
Una nota de crédito reduce el saldo comercial; no inicia devolución ni
refacturación. Las pruebas SQL cubren saldo parcial, reintentos, concurrencia,
mezcla histórica, aplicaciones, notas y el cambio registrado.

## Portal de aerolínea

La API publica lecturas bajo `/api/v1/airline/portal/treasury`
([controlador](../../backend/Elevant.Api/Controllers/AirlineTreasuryController.cs)):

| Sufijo | Lectura |
| --- | --- |
| `statements?asOf=YYYY-MM-DD&stationId=UUID` | Estado fechado y antigüedad, con cobros sin aplicar y crédito a favor; estación opcional. |
| `invoices/{invoiceId}` | Saldo combinado, líneas congeladas, movimientos y notas. |
| `receipts/{receiptId}` | Cobro y sus movimientos registrados. |
| `invoices/{invoiceId}/adjustment-notes` | Notas vinculadas a esa factura, con su e-NCF cuando lo tienen. |

El PDF de una nota se descarga con `GET airline/portal/adjustment-notes/{noteId}/document`.
La única escritura del portal sobre su cartera es el pago con tarjeta
(`POST airline/portal/invoices/{invoiceId}/card-payments`).

El servidor resuelve la cuenta del JWT contra su estado vigente. Exige el rol
`AIRLINE_CLIENT` del portal y una sola organización cliente derivada de
membresías válidas ([acceso](../../backend/Elevant.Application/Abstractions/Finance/FinanceTreasuryPortalAccess.cs)).
Aerolínea y organización deben estar activas y vinculadas, y enviar IDs de
organización o aerolínea no selecciona el tenant.

Las estaciones se derivan de las versiones contractuales aprobadas o
sustituidas de esa aerolínea y, desde la fase 4, también de las estaciones
donde AVIAM atendió sus charters, que no tienen contrato
([alcance](../../database/DevelopmentDB/Elevant.Persistence/Finance/FinanceTreasuryStore.Portal.cs)).
El historial conserva acceso al terminar el plazo contractual y un borrador no
concede cobertura. Cada factura, cobro y nota comprueba aerolínea y estación:
un documento ajeno devuelve 404 y una identidad sin autorización 403; toda
negativa salvo la 401 lleva el `code` de su estado. Los DTO omiten empleados,
auditoría interna y versiones de escritura.

En el portal, «Facturas» ([vista](../../frontend/public-web/src/components/portal/AirlineFinancePage.tsx))
tiene el selector «Facturas | Estado de cuenta» en la misma página: la lista
muestra pendientes, vencidas, saldo pendiente y «Saldo a favor» (crédito a
favor más cobros sin aplicar), y el estado de cuenta
([panel](../../frontend/public-web/src/components/portal/AirlineTreasuryPanel.tsx))
separa monedas, permite elegir corte y nombra cada factura por su e-NCF. El
detalle permite pagar con tarjeta el saldo completo cuando la pasarela está
disponible, con la etiqueta «Simulación — sin validez fiscal», y descargar el
recibo con «Preparando recibo…» y un error recuperable
([pago](../../frontend/public-web/src/components/portal/CardPaymentPanel.tsx)).

## Avisos y revalidación

Cada mutación de cartera publica `airline_treasury` dentro de su transacción,
dirigido solo a las cuentas del cliente; el lector vuelve a comprobar la
membresía vigente antes de mostrar el aviso
([feed](../../database/DevelopmentDB/Elevant.Persistence/Realtime/EfAccountChangeReadStore.cs)).
La emisión también anuncia `airline_preinvoices` sobre su borrador interno, y el
portal lo trata solo como una pista para releer Finanzas
([sesión](../../frontend/public-web/src/components/auth/AirlineSessionProvider.tsx)).
Un reintento idempotente no duplica el aviso.

Las vistas financieras del portal conservan los datos visibles mientras
revalidan: muestran «Actualizando…» y, si la relectura falla, «No se pudo
actualizar. Mostramos los últimos datos.» con «Reintentar»
([instantánea](../../frontend/public-web/src/components/portal/useLiveSnapshot.ts),
[aviso](../../frontend/public-web/src/components/portal/LiveSnapshotNotice.tsx)).
Releen con esos avisos y al recuperar el foco, la visibilidad o la conexión; el
sondeo de 25 segundos ya no relee Finanzas.

## Validación y límites

Las pruebas verifican documentos propios y ajenos en SQL Server, el alcance de
los charters, el rechazo de mutaciones HTTP, los vínculos a líneas y la
navegación al cobro real. Las pruebas SQL crean su base temporal solo con las
migraciones revisadas y la fixture normal de integración. Nada aquí es una
conciliación bancaria: un cobro registrado no confirma fondos en el banco.

Volver al [Mapa de aplicaciones](README.md).
