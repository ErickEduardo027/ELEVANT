# Finanzas integral para servicios de rampa

Plan aprobado en conversación el 2026-10-18. Especificación complementaria: Prompt_Maestro_Codex_Finanzas_Elevant.txt, leído del Desktop; no contiene autorización para emisiones reales ni despliegues.

## Reglas globales
- Una API, una base por ambiente, arquitectura .NET existente, clientes Next/Expo existentes.
- Finanzas gobierna catálogo, tarifas, paquetes; Contratos propone excepciones y Finanzas aprueba la versión contractual. OCC aprueba ejecución. Agente marca tipo de cargo; servidor valora.
- Contrato congelado manda en ejecución, falta/ambigüedad bloquea, nunca precio cero inferido.
- Cuentas por cobrar y pagar, proveedores y reembolsos de empleados incluidos; libro mayor, bancos, firma documental, hojas colaborativas y ESG fuera.
- Proveedor fiscal pendiente. Off predeterminado, LocalSimulation sin red, ProviderSandbox bloqueado. Ninguna emisión real, secreto, e-NCF o firma oficial inventada.
- Historial preservado; cambios aditivos y compatibilidad API, migraciones solo con script, sin DML de negocio.
- Un PR final a Development, sin atribución, usuario hace merge; no despliegue.

## Tareas
1. Datos compartidos y motor: catálogo de Finanzas, paquetes versionados, consumo por ámbito, cargos facturables con origen y cálculo congelado; impuestos explícitos, contratos y enmiendas aprobados. Pruebas GPU 60/61/75/76/83 => 500/520/520/540/540, consumo dividido y concurrencia.
2. Prefactura/factura: reservas por cargo, recalcular explícitamente y diferencias, disputar bloquea, liberar solo borrador anulado; factura inmutable, notas de crédito/débito por línea con límites.
3. Tesorería: cobro separado de aplicación, múltiples facturas, remanente, anticipo, crédito, reverso, devolución, USD/DOP y tasa congelada; estado de cuenta/aging a fecha de corte. Compatibilidad pagos anteriores sin doble conteo.
4. Gastos y cuentas por pagar: proveedores/facturas con referencia única, soporte privado y dimensiones; gastos de empleados con aprobador de departamento y Finanzas sin autoaprobación; pagos separados y saldos.
5. Fiscal: documento canónico, estados comerciales/fiscales/cobro independientes, puertos de firma/proveedor, outbox/inbox e idempotencia, desconocido tras timeout, archivo persistente de bytes/hash/manifest. Simulación de aprobado/rechazado/condicional/pendiente/timeout/desconocido sin red. XSD oficiales verificados en datos sintéticos; tipos no implementados marcados como pendientes.
6. Clientes/reportes: Finanzas catálogo/paquetes, cargos, prefacturas, facturas, cobros, gastos, CxP, fiscal, conciliación y reportes CSV/XLSX/PDF; portal tenant-scoped, estados y descargas reales, móvil compatible.
7. Integración: OpenAPI/client, permisos, auditoría/cambios, migraciones limpias+upgrade, suite .NET y clientes, E2E sintético; ADR/Vault/matriz Odoo/licencias/guía activación/recuperación.

## Interfaces compartidas
Domain agrega agregados en Commercial y enums propios. Application casos de uso y puertos; Contracts DTO públicos. Persistence mappings y stores; Api endpoints delgados; Infrastructure firma, storage y simulador.
Usar UUID RequestId/payload hash y expectedVersion en mutaciones. Dinero decimal(19,4), cantidades decimal(18,4), reglas de redondeo trazadas.

## Aceptación
Sin dobles cargos, reservas, facturas, cobros aplicados, notas o consumo de paquetes bajo carrera SQL. Factura 1000 y aplicación 300 => 700, reintento igual. Un usuario de aerolínea no puede leer adjuntos/export de otra. Off/Simulation no red ni numeración fiscal, archivo previo falla => no envío; archivo conserva bytes tras reinicio.
