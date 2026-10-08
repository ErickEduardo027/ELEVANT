# ADR-0016: Tarifarios, cargos de rampa y cuentas por cobrar no fiscales

## Estado

Accepted — 2026-10-08. Amplía la prefactura y la factura no fiscal existentes.
No introduce facturación tributaria (ITBIS ni NCF).

## Contexto

Hasta ahora el único precio vivía en `ContractServiceRate`, dentro de cada
versión de contrato. Contratos lo editaba y activaba el contrato sin
intervención de Finanzas. El borrador nacía con precio 0 y moneda fija `USD`.
No existían la tarifa base, los recargos, la tasa de cambio, la edición de
prefacturas, los pagos parciales, las notas de crédito, los vencimientos ni los
reportes de servidor. La factura no fiscal admitía un único pago total.

Finanzas necesita:
- gobernar un tarifario completo de servicios y de cargos;
- que los agentes de rampa registren los cargos (nocturno, tiempo extra,
  demora…) sin conocer precios;
- poder corregir los importes antes de facturar;
- llevar la cartera en USD y DOP.

## Decisión

### Tarifarios

- **Tarifa base de servicios:**
  - Versiones `Draft → Published → Superseded` por moneda (USD o DOP).
  - Cada tarifa indica servicio, estación opcional (una tarifa de estación
    gana a la general), unidad de cobro y precio con cuatro decimales.
  - Publicar cierra la versión anterior el día previo. Las versiones publicadas
    son inmutables.
- **Catálogo de cargos** (CRUD gobernado por `finance.charges.manage`). Cada
  cargo define:
  - categoría;
  - método: `FixedAmount`, `PercentOfService`, `PerHour`, `PerMinute` o
    `PerUnit`;
  - regla de cantidad: `One`, `ServiceDuration`, `OperationOverrun`,
    `ArrivalDelay` o `ServiceQuantity`;
  - gracia, redondeo hacia arriba, alcance por servicio, si admite varias
    aplicaciones y si es visible para los agentes.

  El método y la regla deben ser compatibles. Los importes viven en versiones
  del tarifario de cargos por moneda, con mínimo opcional.
- **Unidades de cobro:** son un catálogo (`ref.billing_units`), no texto libre,
  para las tarifas nuevas.
- **Tasa de cambio:** la tasa diaria USD→DOP la registra Finanzas a mano, con
  fuente. Una corrección crea una fila nueva que reemplaza a la anterior, sin
  sobrescribirla.

### Contratos

- El borrador hereda precio y unidad de la tarifa base vigente en su moneda.
- Contratos puede negociar precios y excluir o negociar cargos
  (`contract_charge_rates`).
- «Activar» pasa a **enviar a Finanzas** (`PendingFinanceApproval`). Solo la
  decisión de Finanzas activa la versión. Si Finanzas devuelve el contrato,
  debe indicar el motivo, y la versión vuelve a `Draft`.
- La revisión guarda la comparación con la base en ese momento.
- OCC sigue planificando únicamente versiones aprobadas.

### Cargos aplicados en rampa

- El agente marca solo el **tipo** de cargo en un servicio en curso, completado
  o en excepción, desde un endpoint nuevo (`ramp/operations/{id}/charges`).
- Usa clave idempotente y `X-Elevant-Installation-Id`. Las respuestas no llevan
  precios.
- Es un endpoint separado y no un campo nuevo en la respuesta de la operación,
  porque las APK instaladas validan esa respuesta de forma estricta
  (expand/contract).
- La evidencia de entrega pasa a la versión 2 e incluye las marcas. Si cambian
  después de la aprobación, la valoración se bloquea
  (`approved_evidence_mismatch`).

### Valoración y prefactura

- `FinanceChargePricingPolicy` (pura y probada) calcula cada cargo así:
  1. Mide la cantidad con los tiempos registrados: estados del servicio, fin
     planificado frente a real, o llegada programada frente a real.
  2. Resta la gracia y redondea hacia arriba.
  3. Valora con la tarifa del contrato, si existe; si no, con la tarifa base.
  4. Si falta tarifa en la moneda, convierte con la tasa del día.
  5. Aplica el mínimo. Si falta tarifa o tasa, la línea queda bloqueada.
- Las líneas de prefactura tienen `Kind` (`Service`, `Charge`, `Adjustment`) y
  una línea padre.
- En `Draft`, Finanzas puede:
  - cambiar el importe de cualquier línea;
  - excluir un cargo;
  - añadir ajustes (que pueden ser negativos).

  Cada cambio exige motivo y versión esperada, y queda auditado. El valor
  calculado se conserva junto al facturado.
- La aerolínea ve cada cargo y ajuste como línea propia, con su motivo, y puede
  disputarlo.

### Cuentas por cobrar no fiscales

- La factura gana vencimiento, calculado con el plazo del perfil de
  facturación de la aerolínea (30 días por defecto).
- Admite varios pagos (método y fecha) y notas de crédito idempotentes.
- El saldo es: total − pagos − notas. Nunca puede quedar negativo.
- El estado (`Pending`, `PartiallyPaid`, `Paid`, `Overdue`) es una proyección.
  No se guarda.
- La aerolínea consulta su estado de cuenta por un endpoint nuevo
  (`airline/portal/invoices/{id}/statement`), sin nombres de personal.

### Reportes

- Ocho reportes calculados en el servidor sobre las estaciones del actor:
  1. ingresos;
  2. cuentas por cobrar y antigüedad;
  3. cobranza;
  4. pipeline;
  5. cargos y ajustes;
  6. disputas;
  7. uso de tarifas;
  8. notas de crédito.
- Exportan a CSV (con BOM y protección contra fórmulas) o a PDF no fiscal, con
  `finance.reports.export`.
- La exportación queda auditada.

### Permisos

Nuevos módulos del catálogo de Finanzas:
- `tariffs.manage`
- `charges.read|manage`
- `exchange_rates.read|manage`
- `contract_approvals.read|decide`

Los administradores de Finanzas los heredan.

## Consecuencias

- **Migración:** `AddFinanceTariffsAndCharges` es aditiva.
  - Su `Down` se niega a ejecutarse si ya existen líneas que no son de
    servicio, marcas de rampa, notas de crédito o varios pagos por factura,
    porque revertirla destruiría historia financiera.
  - Production nunca se siembra: tarifas, cargos y tasas se capturan desde la
    interfaz.
- **Activación de contratos:** ya no puede ocurrir sin Finanzas. Los clientes
  que llamaban a «activar» reciben ahora `PendingFinanceApproval`.
- **Clientes ya publicados:** los nuevos datos viajan por endpoints nuevos, de
  modo que las versiones estrictas ya publicadas de los clientes siguen
  funcionando. La factura existente (`NonFiscalInvoiceResponse`) no cambia de
  forma.
- **Fuera de alcance:** la facturación fiscal, la conciliación bancaria y la
  obtención automática de tasas siguen excluidas.
