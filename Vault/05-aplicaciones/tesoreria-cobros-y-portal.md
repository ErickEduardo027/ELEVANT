---
id: tesoreria-cobros-y-portal
title: "Cobros, aplicaciones y consulta de aerolínea"
type: capability
area: applications
status: documented
maturity: evolving
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-10-19"
verified_commit: "2f57941912f4dffe40355dc75aea8f63af7f26d4"
sources:
  - backend/Elevant.Api/Controllers/AirlineTreasuryController.cs
  - backend/Elevant.Application/Abstractions/Finance/FinanceTreasuryPortalAccess.cs
  - backend/Elevant.Contracts/Finance/AirlineTreasuryContracts.cs
  - database/DevelopmentDB/Elevant.Persistence/Finance/FinanceTreasuryStore.Portal.cs
  - database/DevelopmentDB/Elevant.Persistence/Operations/AirlineOperationChangeWriter.cs
  - database/DevelopmentDB/Elevant.Persistence/Realtime/EfAccountChangeReadStore.cs
  - frontend/private-web/src/features/finance/invoices/InvoicesPage.jsx
  - frontend/public-web/src/components/portal/AirlineTreasuryPanel.tsx
  - frontend/public-web/src/components/auth/AirlineSessionProvider.tsx
  - backend/tests/Elevant.IntegrationTests/Persistence/SqlServerMigrationTests.FinanceTreasuryPortal.cs
  - backend/tests/Elevant.IntegrationTests/Persistence/SqlServerMigrationTests.FinanceTreasury.cs
  - backend/tests/Elevant.IntegrationTests/Persistence/SqlServerMigrationTests.FinanceTreasuryCompatibility.cs
  - frontend/public-web/tests/unit/airline-treasury-panel.test.tsx
tags:
  - finanzas
  - cobros
  - aerolineas
---

# Cobros, aplicaciones y consulta de aerolínea

Esta nota describe la implementación local de la rama de Finanzas. No acredita
merge, despliegue ni aceptación operativa. La migración se revisa y ejecuta como
parte de la integración compartida.

## Factura y cobro

La vista interna monta notas por línea y abre cobros mediante
`onOpenReceipt(receiptId, contextoFactura)`. La gestión sin cobro seleccionado
usa un identificador nulo; una aplicación abre el identificador real del cobro.
Sin ese callback, la vista abre Tesorería con estación, aerolínea y factura.
Los registros históricos siguen visibles como tales.

Un cobro puede quedar sin aplicar, cubrir parcialmente una factura o repartirse.
Revertir una aplicación, revertir un cobro y devolver efectivo son movimientos
distintos. Una nota de crédito reduce el saldo comercial; no inicia devolución
ni refacturación. Las pruebas SQL cubren saldo parcial, reintentos, concurrencia,
mezcla histórica y aplicaciones, notas y cambio registrado.

## Portal de aerolínea

La API publica exclusivamente GET bajo `/api/v1/airline/portal/treasury`:

| Sufijo | Lectura |
| --- | --- |
| `statements?asOf=YYYY-MM-DD&stationId=UUID` | Estado fechado y antigüedad; estación opcional. |
| `invoices/{invoiceId}` | Saldo combinado, líneas congeladas, movimientos y notas. |
| `receipts/{receiptId}` | Cobro y sus movimientos registrados. |
| `invoices/{invoiceId}/adjustment-notes` | Notas vinculadas a esa factura. |

El servidor resuelve la cuenta del JWT contra su estado vigente. Exige el rol
AIRLINE_CLIENT del portal de aerolínea y una sola organización cliente derivada
de membresías válidas. Aerolínea y organización deben estar activas y vinculadas.
Enviar IDs de organización o aerolínea no selecciona el tenant.

Las estaciones se derivan de versiones contractuales aprobadas o sustituidas de
esa aerolínea y estaciones activas. El historial conserva acceso al terminar el
plazo contractual; un borrador no concede cobertura. Cada factura, cobro y
consulta de notas comprueba aerolínea y estación. Un documento ajeno devuelve
404; una identidad sin autorización devuelve 403. Los DTOs omiten empleados,
auditoría interna y versiones de escritura.

El panel público reutiliza el diseño del portal, separa monedas, permite elegir
corte y navegar entre factura, cobro y líneas de notas. Combina pagos y créditos
históricos con aplicaciones y notas nuevas. Su servicio sólo contiene GET y toma
el token del proveedor de sesión. Se descartan respuestas de una sesión anterior.
Los errores no muestran detalles internos. El panel no tiene controles de mutación.

Cada mutación de cartera publica `airline_treasury` dentro de su transacción,
dirigido solo a las cuentas del cliente. El identificador corresponde a la
aerolínea; el lector vuelve a comprobar su membresía vigente antes de mostrar
el aviso. El portal actualiza sus vistas financieras con ese recurso y con
`airline_preinvoices`. Un reintento idempotente no duplica el aviso.

Las notas históricas y las notas por línea comparten el límite monetario de
crédito de la factura original. Un débito aumenta el saldo por cobrar, pero no
amplía ese límite. Ambas rutas serializan la decisión sobre la misma factura.

## Validación y límites

Las pruebas verifican documentos propios y ajenos en SQL Server, rechazo de
mutaciones HTTP, vínculos a líneas y navegación al cobro real. Las pruebas SQL
crean su base temporal exclusivamente mediante las migraciones revisadas y la
fixture normal de integración; no hay creación de tablas alternativa. El acceso
histórico contractual es específico de Finanzas e independiente de la ventana
operativa del bootstrap.

Se conserva la composición IFinanceTreasuryStore → FinanceTreasuryStore: este
slice agrega métodos de lectura y DTOs, sin más DI ni cambios de esquema. El
cliente compartido y el snapshot OpenAPI se regeneran en la integración conjunta.

Volver al [Mapa de aplicaciones](README.md).
