---
id: dominio-glosario-canonico
title: "Glosario canónico"
type: reference
area: domain
status: verified
maturity: evolving
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-09-12"
verified_commit: "0c392571a9a235ff5e75846d14b2a127b6c25c73"
sources:
  - README.md
  - docs/architecture/database-v1.md
  - docs/database/schema-v1.md
  - backend/Elevant.Domain/Enumerations/IdentityEnums.cs
  - backend/Elevant.Domain/Enumerations/OperationsEnums.cs
  - backend/Elevant.Domain/Enumerations/WorkforceCommercialEnums.cs
  - database/DevelopmentDB/Elevant.Persistence/Persistence/Configurations/OperationsConfiguration.cs
  - database/DevelopmentDB/Elevant.Persistence/Persistence/Configurations/IntegrationAuditConfiguration.cs
  - database/DevelopmentDB/Elevant.Persistence/Persistence/Configurations/PlatformConfiguration.cs
  - frontend/private-web/README.md
  - frontend/public-web/README.md
  - frontend/mobile-agent/README.md
tags:
  - glosario
  - lenguaje-ubiquo
  - operaciones
  - referencia
---

# Glosario canónico

Este glosario normaliza términos usados por código, base y prototipos. “Canónico” significa que el concepto tiene respaldo en el modelo o en una decisión versionada; no significa que ya tenga endpoint público.

## Plataforma y actores

| Término | Significado | No confundir con |
| --- | --- | --- |
| ELEVANT | Plataforma de AVIAM para planificar y controlar asistencia en tierra. | Una sola de sus interfaces. |
| AVIAM | Organización operadora interna modelada como `AviamOperator`. | Una aerolínea cliente. |
| OCC | Función interna de control operacional observada en Private Web y en el flujo de revisión. | Un rol único y definitivo; la taxonomía fina aún no está cerrada. |
| Aerolínea cliente | Organización cliente con perfil canónico `Airline` y códigos aeronáuticos. | El texto libre de una solicitud previa a afiliación. |
| Agente de rampa | Persona con perfil laboral `RampAgent`, scopes y habilitaciones operativas. | Cuenta, rol IAM o asignación concreta. |
| Tenant | Organización que delimita los datos del cliente; para el portal se deriva de una membresía autenticada. | `airlineId` enviado por el navegador. |

## Identidad y acceso

| Término | Significado | Invariante clave |
| --- | --- | --- |
| Persona | Identidad humana y datos de contacto/identificación. | Puede tener como máximo una cuenta y un perfil de agente en el modelo actual. |
| Cuenta | Credencial ASP.NET Identity vinculada uno-a-uno con una persona. | Tiene ciclo de vida e invitación propios. |
| Organización | Entidad jurídica/operativa: AVIAM o cliente aerolínea. | La membresía, no el frontend, vincula una cuenta al tenant. |
| Membresía | Relación temporal cuenta-organización con tipo, estado y job title. | No equivale a rol ni a scope de estación. |
| Rol | Agrupación de acceso asociada a un portal y `userType`. | No equivale a departamento, posición operativa o cargo. |
| Permiso | Capacidad autorizable asignada a roles. | Un texto de botón o menú no concede permiso. |
| Scope de estación | Concesión revocable de una cuenta sobre una estación. | El scope laboral del agente usa tablas separadas. |
| Empleado | Expediente de Gestión Humana de una persona de AVIAM: departamento, puesto, estaciones, ingreso y baja. | Solo un empleado activo recibe cuenta interna; la baja la desactiva para siempre. |
| Puesto | Cargo del organigrama de un departamento, mantenido por Gestión Humana. | No es un perfil de acceso ni una posición operativa de rampa. |
| Perfil de acceso | Plantilla de permisos de un departamento que decide qué ve una cuenta en ELEVANT. | Lo administra el departamento; no cambia el puesto. |
| Requisición de personal | Petición de un departamento a Gestión Humana de N personas para un puesto. | Lo cubierto es una proyección de los empleados enlazados. |

## Geografía y catálogos

| Término | Significado | Relación |
| --- | --- | --- |
| Aeropuerto | Lugar canónico con códigos IATA/ICAO, ciudad y país. | En v1 una estación referencia un aeropuerto y el índice actual hace esa relación uno-a-uno. |
| Estación | Unidad operativa de AVIAM en un aeropuerto, con código y zona IANA. | Enmarca scopes, turnos, equipos y operaciones. |
| Terminal | Subdivisión de una estación. | Agrupa stands y scopes laborales. |
| Stand o posición física | Lugar donde se atiende la aeronave; puede pertenecer a una terminal. | No es `OperationalPosition`, que es un puesto/función. |
| Definición de servicio | Catálogo de servicios y unidad de cobro predeterminada. | No es una línea solicitada, contratada ni ejecutada. |
| Tipo de equipo | Clase de recurso; puede exigir habilitación. | No es un activo físico. |
| Activo de equipo | Unidad identificada y ubicada en una estación. | Se asigna temporalmente a una operación. |
| Tipo de aeronave | Catálogo de fabricante/modelo con código ICAO. | La matrícula pertenece al turnaround concreto. |
| Posición operativa | Puesto o función de trabajo; puede exigir habilitación/equipo. | No es stand, rol IAM ni `AssignmentRole`. |

## Vuelo y operación

| Término | Significado | Invariante clave |
| --- | --- | --- |
| Turnaround | Escala aeroportuaria de una aerolínea en una estación y fecha; raíz de planificación. | Tiene como máximo un tramo de llegada y uno de salida. |
| Tramo de vuelo | Llegada o salida con número, ruta, tiempos y procedencia. | No representa por sí solo toda la escala. |
| Operación en tierra | Ejecución asociada uno-a-uno al turnaround. | Posee asignaciones, servicios, hitos, checklist, incidentes y revisión. |
| Asignación de stand | Relación temporal turnaround-stand. | Sólo una asignación abierta por turnaround en el modelo. |
| Asignación de agente/equipo | Relación temporal entre la operación y un recurso. | Sustituye arrays duplicados dentro de un vuelo mock. |
| Servicio de operación | Línea ejecutable con definición obligatoria, tarifa contractual opcional y columnas snapshot de cobro. | La FK opcional no demuestra la procedencia ni coherencia del snapshot; esas reglas siguen pendientes. |
| Hito | Momento planeado, estimado o real dentro de una operación. | Sus estados no son los estados del turnaround. |
| Incidente | Evento operacional reportado con severidad, estado y resolución. | Evidencia binaria asociada sigue diferida. |

## Checklist y revisión

| Término | Significado |
| --- | --- |
| Template de checklist | Definición nombrada y versionable del procedimiento. |
| Versión de checklist | Snapshot temporal publicable con ítems ordenados. |
| Checklist de operación | Instancia de una versión aplicada a una operación. |
| Respuesta | Valor `Ok`, `NotApplicable` o `NotOk`, con nota y agente respondiente. |
| Envío de operación | Revisión numerada del checklist enviada a control. |
| Decisión de revisión | Resultado `Approved` o `Returned` emitido por una cuenta revisora. |

Las unicidades impiden duplicar una respuesta por pareja checklist-ítem y una revisión por pareja operación-número. No prueban que el ítem pertenezca a la versión del checklist ni que el checklist de un envío pertenezca a la misma operación. Un envío tampoco captura las respuestas como snapshot; por ello, otra revisión no preserva por sí sola el contenido anterior.

## Comercial y solicitudes

| Término | Significado | No confundir con |
| --- | --- | --- |
| Solicitud comercial | Solicitud de afiliación o servicio adicional que puede preceder a una aerolínea canónica. | Solicitud operativa ligada a una estación/turnaround. |
| Solicitud operativa | Petición de servicio durante la operación, con solicitante, necesidad y resolución. | Afiliación o negociación contractual. |
| Contrato | Acuerdo de una aerolínea, opcionalmente originado en una solicitud comercial. | Una versión concreta del acuerdo. |
| Versión de contrato | Vigencia, moneda, términos, estaciones y tarifas aprobables. | El estado general del contrato. |
| Tarifa de servicio | Precio/unidad/mínimo de un servicio en una versión. | El snapshot guardado en una ejecución. |
| Tarifa base | Precio de referencia de Finanzas por servicio, moneda y estación opcional; versión publicada e inmutable. | La tarifa negociada de un contrato. |
| Cargo | Recargo o cargo adicional del catálogo de Finanzas (nocturno, tiempo extra…) con método y regla de cantidad. | Un ajuste manual de Finanzas. |
| Marca de cargo | Tipo de cargo que el agente de rampa aplica a un servicio, sin precio ni cantidad. | La línea de cargo valorada en la prefactura. |
| Ajuste | Línea manual de Finanzas en una prefactura borrador, positiva o negativa, con motivo. | Una nota de crédito sobre una factura emitida. |
| Aprobación de Finanzas | Revisión que activa una versión de contrato enviada por Contratos o la devuelve con motivo. | La aprobación de una entrega por OCC. |
| Tasa de cambio | Tasa diaria USD→DOP registrada manualmente por Finanzas; las correcciones conservan historia. | Una cotización bancaria automática. |
| Nota de crédito | Reducción no fiscal del saldo de una factura, idempotente y nunca mayor que el saldo. | Una anulación de prefactura. |
| Saldo | Total de la factura menos pagos y notas de crédito; su estado (pendiente, parcial, pagada, vencida) es una proyección. | Una conciliación bancaria. |

## Integración y trazabilidad

| Término | Significado |
| --- | --- |
| Dispositivo móvil | Instalación registrada con plataforma, versión, última actividad y revocación. |
| Binding | Registro temporal separado que vincula dispositivo y cuenta; sólo uno puede permanecer no cerrado por dispositivo. |
| Recibo de comando | Registro separado que referencia dispositivo y cuenta y deduplica por dispositivo-clave, con hash, estado y resultado/error sanitizable. No demuestra que esa cuenta sea el binding activo ni que el dispositivo esté vigente. |
| Auditoría | Entrada atribuible y correlacionable, con cambios de campos separados. |
| Outbox | Mensaje persistido con evento, payload, fecha de proceso, intentos y último error para publicación transaccional posterior; no tiene campo de resultado ni es chat. |
| Read model | Proyección calculada como KPI, cobertura, elegibilidad, vencimiento o contador; no tabla autoritativa por defecto. |

## Vocabulario que sigue siendo de prototipo

Los departamentos `ADMIN_OCC`, `GESTION_HUMANA`, `CONTRATOS` y `FINANZAS`, los roles detallados de las interfaces, los estados descriptivos de vuelo del Mobile Agent y los objetos de factura/documento/notificación de Public Web expresan necesidades de UX. No amplían automáticamente los enums del dominio, la autorización ni el esquema.

Cuando un término de interfaz contradiga este glosario, conserva ambos como evidencia de una pregunta abierta; no renombres el modelo sin una decisión, migración y contrato coordinados.

## Relacionados

- [Índice de dominio](README.md)
- [Entidades y relaciones v1](entidades-y-relaciones-v1.md)
- [Personal, roles y departamentos](personal-roles-y-departamentos.md)
- [Tiempo, estados y trazabilidad](tiempo-estados-y-trazabilidad.md)

## Fuentes

- [Modelo de base de datos v1](../../docs/architecture/database-v1.md)
- [Inventario del esquema](../../docs/database/schema-v1.md)
- [Enums de identidad](../../backend/Elevant.Domain/Enumerations/IdentityEnums.cs)
- [Enums operativos](../../backend/Elevant.Domain/Enumerations/OperationsEnums.cs)
- [Enums de personal y comercial](../../backend/Elevant.Domain/Enumerations/WorkforceCommercialEnums.cs)
