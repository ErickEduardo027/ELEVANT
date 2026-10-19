# Adaptación de flujos de Odoo a Finanzas de ELEVANT

## Versión, procedencia y límites

La revisión usa **Odoo Community 19.0**, fijado al commit [`53ec5874899470427115254cf09f83c969ab360d`](https://github.com/odoo/odoo/tree/53ec5874899470427115254cf09f83c969ab360d). Las URL de esta nota contienen ese commit; la rama `19.0` mutable no es la referencia de implementación.

Se leyeron el LICENSE real, los manifests y los archivos seleccionados descargados en `.superpowers/sdd/2026-10-18-finance-platform/odoo-reference`. Es evidencia local de revisión; los enlaces públicos fijados permiten repetirla sin depender de ese directorio de trabajo. El contraste documental de esta nota se hizo el 2026-10-19.

**No se copió código de Odoo.** Los módulos son implementación propia C#/React sobre la API, persistencia y componentes existentes de ELEVANT. No se instala Odoo, su ORM, sus vistas ni su contabilidad. Se adaptan revisión, navegación entre documentos, pagos y gastos a estaciones, aerolíneas, turnarounds y servicios de rampa. La UI conserva el diseño y comportamiento responsive de ELEVANT.

## Licencias efectivamente revisadas

El [LICENSE raíz](https://github.com/odoo/odoo/blob/53ec5874899470427115254cf09f83c969ab360d/LICENSE) declara LGPLv3 e incluye el texto GPL complementario; también advierte que componentes externos pueden tener otras licencias. Esto no permite atribuir una sola licencia a cualquier addon no revisado.

| Módulo revisado | Versión del manifest | Licencia declarada | Fuente fijada |
| --- | --- | --- | --- |
| product | 1.2 | LGPL-3 | [manifest](https://github.com/odoo/odoo/blob/53ec5874899470427115254cf09f83c969ab360d/addons/product/__manifest__.py) |
| sale | 1.2 | LGPL-3 | [manifest](https://github.com/odoo/odoo/blob/53ec5874899470427115254cf09f83c969ab360d/addons/sale/__manifest__.py) |
| account | 1.5 | LGPL-3 | [manifest](https://github.com/odoo/odoo/blob/53ec5874899470427115254cf09f83c969ab360d/addons/account/__manifest__.py) |
| account_edi | 1.0 | LGPL-3 | [manifest](https://github.com/odoo/odoo/blob/53ec5874899470427115254cf09f83c969ab360d/addons/account_edi/__manifest__.py) |
| hr_expense | 2.1 | LGPL-3 | [manifest](https://github.com/odoo/odoo/blob/53ec5874899470427115254cf09f83c969ab360d/addons/hr_expense/__manifest__.py) |
| analytic | 1.2 | LGPL-3 | [manifest](https://github.com/odoo/odoo/blob/53ec5874899470427115254cf09f83c969ab360d/addons/analytic/__manifest__.py) |
| l10n_do | 2.0 | LGPL-3 | [manifest](https://github.com/odoo/odoo/blob/53ec5874899470427115254cf09f83c969ab360d/addons/l10n_do/__manifest__.py) |

La versión de un manifest es la versión del módulo, no un reemplazo del commit que fija el código. El hash SHA-256 del LICENSE descargado es `abc09dad5f84a76e1b0279237053cae16c03228ab27d8d467677054c2bd17eeb`. No se deduce una autorización para copiar código, recursos visuales o módulos Enterprise de esta revisión; una futura incorporación de terceros exige revisar sus archivos y obligaciones específicas.

## Matriz de métodos y adaptación

| Fuente y método en Odoo | Comportamiento observado | Implementación propia y diferencia de ELEVANT |
| --- | --- | --- |
| [product.pricelist.item._compute_price](https://github.com/odoo/odoo/blob/53ec5874899470427115254cf09f83c969ab360d/addons/product/models/product_pricelist_item.py#L570) | Precio fijo, descuento porcentual sobre una base, fórmula con redondeo, recargo y límites de margen; conversión de unidad y moneda. | [Tarifas/cargos](../../backend/Elevant.Application/Finance/FinanceChargePricingPolicy.cs), [mínimo](../../backend/Elevant.Application/Finance/FinanceMinimumPricingPolicy.cs) y [paquete](../../backend/Elevant.Application/Finance/FinancePackagePricingPolicy.cs) congelan una base contractual aprobada. Dinero decimal de cuatro posiciones y FX explícito. El mínimo contractual de cantidad no es el margen mínimo de Odoo. No se implementa el grafo general de pricelists ni se revalora historia con una lista actual. |
| [account.payment.action_post](https://github.com/odoo/odoo/blob/53ec5874899470427115254cf09f83c969ab360d/addons/account/models/account_payment.py#L1130) | Confirma el pago y decide estados de proceso; valida confianza de cuenta bancaria cuando corresponde. La navegación a facturas es una acción separada. | [Tesorería](../../database/DevelopmentDB/Elevant.Persistence/Finance/FinanceTreasuryStore.Commands.cs) registra recibo y después aplicaciones; [CxP](../../database/DevelopmentDB/Elevant.Persistence/Finance/FinancePayablesStore.Payments.cs) registra pago y después aplicaciones. Varios documentos, parcialidad y remanente. El registro manual no comprueba fondos bancarios y no se importa una cuenta bancaria o asiento de Odoo. |
| [account.move._reverse_moves](https://github.com/odoo/odoo/blob/53ec5874899470427115254cf09f83c969ab360d/addons/account/models/account_move.py#L5508) | Crea movimientos reversos vinculados al original mediante reversed_entry_id y, cuando procede, concilia el reverso. | [Notas comerciales](../../database/DevelopmentDB/Elevant.Persistence/Finance/FinanceTreasuryStore.Adjustments.cs) de crédito/débito referencian factura y líneas originales con límites; reversos/devoluciones son movimientos propios. No se sobrescribe la factura. Una nota de crédito no es una devolución de dinero y no se crea un libro mayor. |
| [account.edi.document._process_job](https://github.com/odoo/odoo/blob/53ec5874899470427115254cf09f83c969ab360d/addons/account_edi/models/account_edi_document.py#L103) | Procesa un trabajo mediante el formato EDI, conserva resultado, adjunto y errores y decide estados de envío/cancelación. | [Dispatch fiscal](../../database/DevelopmentDB/Elevant.Persistence/Finance/FinanceFiscalStore.Dispatch.cs) usa intención durable, archivo de originales, un reclamo de envío y respuesta separada del estado comercial. Conserva evidencia en vez de limpiar originales. Timeout/desconocido no autoriza reenvío ciego. El único adaptador ejecutable es local y no usa red fiscal. |
| [hr.expense.action_approve](https://github.com/odoo/odoo/blob/53ec5874899470427115254cf09f83c969ab360d/addons/hr_expense/models/hr_expense.py#L1148) | Verifica autorización, advierte duplicados antes de aprobar; rechazo y contabilización son acciones separadas. | [Gastos de empleados](../../database/DevelopmentDB/Elevant.Persistence/Finance/FinancePayablesStore.Expenses.cs): Employee activo vinculado a la cuenta, soporte privado, revisión de administrador del propio departamento y aprobación final de Finanzas, sin autoaprobación ni misma persona en ambas etapas. El reembolso se registra aparte. No se replica la contabilización automática de Odoo. |
| [analytic.mixin](https://github.com/odoo/odoo/blob/53ec5874899470427115254cf09f83c969ab360d/addons/analytic/models/analytic_mixin.py#L12) | Modela una distribución analítica y sus cuentas como dimensión independiente. | Dimensiones operativas de [CxP/gastos](../../backend/Elevant.Application/Finance/FinancePayablesModels.cs): estación, aerolínea, turnaround y servicio, con relaciones verificadas por API. No hay porcentajes analíticos libres, plan de cuentas ni imputación al libro mayor. |
| [l10n_do manifest](https://github.com/odoo/odoo/blob/53ec5874899470427115254cf09f83c969ab360d/addons/l10n_do/__manifest__.py) | Describe plan de cuentas, impuestos y secuencias; advierte que sus secuencias NCF requieren módulos de terceros o desarrollo adicional. | [Tratamientos explícitos](../../backend/Elevant.Application/Finance/FinanceTaxCalculator.cs); `Unconfigured` no se interpreta como cero. No se importan tasas, NCF, e-NCF, secuencias, contribuyentes ni supuesta certificación. Los [XSD oficiales DGII](dgii-ecf-schema-sources.md) se verifican por su propia fuente y hash. |

### Reglas específicas de rampa que la referencia no aporta

- Aprobación OCC y evidencia de ejecución son la fuente de cantidades; la marca del agente identifica el cargo y no su precio.
- El contrato aprobado conserva los precios y las excepciones. Una enmienda crea versión; no altera ejecución o facturas anteriores.
- El paquete consume una base por ámbito y solo bloques adicionales todavía no cobrados. Un ámbito con prefactura activa sin emitir bloquea otra; anular libera reservas sin borrar historia.
- El complemento de mínimos se limita a versiones modernas `PricingPolicyVersion > 0`, sin reinterpretar contratos heredados.
- Porcentajes cuya base en un paquete no esté resuelta y monedas sin FX bloquean explícitamente.
- Un gasto propio no necesita una concesión del catálogo de Finanzas: la API comprueba Employee activo y membresía interna. El administrador revisa su departamento, y Finanzas decide/paga con sus permisos y sin autoaprobación.
- El portal de aerolínea recibe solo su tenant y no recibe soportes o PII de empleados.

## Huellas de los archivos fuente revisados

Estos hashes identifican los bytes descargados; los métodos anteriores se revisaron en ellos, no solo en documentación comercial.

| Archivo upstream | SHA-256 |
| --- | --- |
| addons/product/models/product_pricelist_item.py | 2a07ec5bf3cde183b4430bf80bb6e7c2108090d3d00b5061f316de6c444c3a3c |
| addons/account/models/account_payment.py | 9c8290d00e3c3e8e2903e4ed1de8225961c8783e5644046196dcab3e5736da41 |
| addons/account/models/account_move.py | 5764c78860e9a9d689e39242f51573a3ccd8bf189607ad1943e0c0b2137cf82b |
| addons/account_edi/models/account_edi_document.py | abf07386ca0a9fe25909af9b38e5cbc7701c621662d77e685a0527eeb932a45e |
| addons/hr_expense/models/hr_expense.py | a9b798e328db651b8dbafb4080733b737b25eb5247e52841c14a1eace1434a07 |
| addons/analytic/models/analytic_mixin.py | 933289b91f27939131db9c9ed45a683b0101bc1da6ae872bfff34856af6e4c23 |

## Referencia de proveedor: aún sin selección

Se consultaron [factura.com.do/integraciones](https://factura.com.do/integraciones) y [factura.com.do/desarrolladores](https://factura.com.do/desarrolladores) el 2026-10-19. Describen una API REST versionada, autenticación de API y notificaciones. Son referencias públicas de evaluación, no un contrato adoptado ni una garantía de compatibilidad de ELEVANT.

La página de desarrolladores declara ausentes un header Idempotency-Key, HMAC/firma del payload de webhook, reintentos automáticos de webhooks y una política formal de deprecación. El futuro contrato deberá resolver esas brechas, autenticación y replay de callbacks, consulta tras timeout y versionado antes de conectar. No se toman los ejemplos de RNC, secuencia o claves como datos operativos.

La selección, contratación, conectividad y emisión real siguen fuera de la etapa autorizada. Véanse el [ADR-0018](../adr/0018-finance-commercial-platform-and-fiscal-simulation.md) y el [runbook](../runbooks/finance-fiscal-activation.md).
