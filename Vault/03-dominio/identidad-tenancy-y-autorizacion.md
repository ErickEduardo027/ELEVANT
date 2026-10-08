---
id: dominio-identidad-tenancy-autorizacion
title: "Identidad, tenancy y autorización"
type: architecture
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
  - database/DevelopmentDB/Elevant.Persistence/Identity/ApplicationUser.cs
  - database/DevelopmentDB/Elevant.Persistence/Identity/ApplicationRole.cs
  - database/DevelopmentDB/Elevant.Persistence/Persistence/Configurations/IdentityReferenceConfiguration.cs
  - database/DevelopmentDB/Elevant.Persistence/Persistence/Seed/DevelopmentDataSeeder.cs
  - backend/Elevant.Domain/Entities/Identity/OrganizationMembership.cs
  - backend/Elevant.Domain/Entities/Identity/AccountStationScope.cs
  - backend/Elevant.Domain/Entities/Integration/MobileDevice.cs
  - backend/Elevant.Domain/Entities/Integration/MobileDeviceAccountBinding.cs
  - backend/Elevant.Domain/Entities/Integration/MobileCommandReceipt.cs
  - backend/Elevant.Domain/Enumerations/IdentityEnums.cs
  - database/DevelopmentDB/Elevant.Persistence/Persistence/Configurations/IntegrationAuditConfiguration.cs
  - frontend/public-web/README.md
  - frontend/mobile-agent/README.md
tags:
  - identidad
  - tenancy
  - autorizacion
  - scopes
---

# Identidad, tenancy y autorización

El modelo separa quién es una persona, cómo inicia sesión, para qué organización trabaja y en qué estaciones puede actuar. Esta separación es la base de la autorización server-side; una selección de interfaz nunca reemplaza esas relaciones.

## Cadena de identidad

```mermaid
flowchart LR
    PERSON[Person] --> ACCOUNT[Account]
    ACCOUNT --> MEMBERSHIP[OrganizationMembership]
    MEMBERSHIP --> ORG[Organization]
    ORG --> AIRLINE[Airline opcional]
    ACCOUNT --> ROLES[Roles]
    ROLES --> PERMISSIONS[Permissions]
    ACCOUNT --> STATIONS[AccountStationScope]
    PERSON --> AGENT[RampAgent opcional]
    AGENT --> WORKSCOPE[Scopes laborales de estación y terminal]
    DEVICE[MobileDevice] --> BINDING[MobileDeviceAccountBinding]
    ACCOUNT --> BINDING
    DEVICE --> RECEIPT[MobileCommandReceipt]
    ACCOUNT --> RECEIPT
```

## Conceptos independientes

| Concepto | Qué responde | Regla persistente relevante |
| --- | --- | --- |
| `Person` | ¿Quién es el ser humano? | Identificación tipo-número única; email único cuando existe. |
| `Account` | ¿Qué credencial accede? | Una cuenta por persona; username normalizado único. |
| `OrganizationMembership` | ¿Con qué organización y calidad se relaciona? | Pareja cuenta-organización única; si ambas fechas existen, `ValidTo` no puede preceder a `ValidFrom`. El estado no se alinea automáticamente con esas fechas. |
| `Role` | ¿Qué agrupación de acceso usa en qué portal? | Nombre único; portal y `userType` propios. |
| `PermissionDefinition` | ¿Qué capacidad autorizable existe? | Código único; relación muchos-a-muchos con roles. |
| `AccountStationScope` | ¿Sobre qué estación puede actuar la cuenta? | Sólo una concesión activa por cuenta-estación. |
| `RampAgent` | ¿Cuál es el perfil laboral operativo? | Uno por persona en v1; tiene scopes laborales separados. |

## Tenant del portal de aerolínea

La regla documental es fail-closed:

1. autenticar la cuenta;
2. enumerar las membresías activas de tipo `AirlineClient`;
3. resolver exactamente un contexto de organización válido, o validar un contexto elegido explícitamente en el servidor;
4. fallar de forma cerrada si no existe contexto o hay más de uno y no se puede desambiguar;
5. obtener la organización asociada y su perfil `Airline`;
6. intersectar la operación con las estaciones autorizadas;
7. aplicar ese scope en cada consulta y escritura;
8. rechazar identificadores fuera del scope, aunque existan.

La unicidad persistida es por pareja cuenta-organización; por tanto, el modelo permite que una cuenta tenga membresías activas simultáneas en organizaciones distintas. El contexto multi-organización y su selección todavía no están definidos por un caso de uso.

Un `organizationId`, `airlineId` o `stationId` recibido desde Public Web sólo puede ser criterio de selección después de validarse contra la sesión. `localStorage`, filtros, rutas o menús ocultos no son controles de acceso.

## Acceso interno y móvil

El acceso interno combina cuenta activa, membresía interna, asignación de departamento con sus permisos de acción y scope de estación. Un rol global no debe habilitar automáticamente todas las aerolíneas o estaciones. El modelo de superadministrador único, administradores por departamento y validación de altas por Gestión Humana está en [Gobernanza de usuarios por departamento](gobernanza-por-departamento.md).

En persistencia, `MobileDevice`, `MobileDeviceAccountBinding`, `Account` y `MobileCommandReceipt` son conceptos separados. Se materializan la unicidad de `InstallationId`, un máximo de un binding no cerrado por dispositivo y el dedupe de recibos por `(MobileDeviceId, IdempotencyKey)`. El recibo referencia dispositivo y cuenta de forma independiente.

Para Mobile Agent, la futura API debe derivar cuenta, binding de dispositivo, perfil de agente y scopes laborales. De esas coherencias de autorización, el esquema sólo materializa el dedupe dispositivo-clave: no prueba que el binding siga activo, que la cuenta del recibo sea la enlazada, que la cuenta esté activa ni que el dispositivo no esté revocado al ejecutar. Tampoco alinea estado del recibo con `ProcessedAt`, resultado y error, ni implementa que un reintento devuelva exactamente el resultado almacenado. Enviar otro `agentId`, `personId` o `stationId` no debe ampliar permisos. La caché/outbox local conserva trabajo pendiente, pero no decide tenant ni estado canónico.

## Vocabulario de ciclo de vida

| Tipo | Valores persistibles |
| --- | --- |
| Organización | `Active`, `Inactive` |
| Cuenta | `Active`, `PendingActivation`, `InvitationSent`, `Disabled`, `Blocked` |
| Invitación | `NotSent`, `Sent`, `Expired`, `Accepted` |
| Membresía | `Active`, `Suspended`, `Ended` |
| Tipo de membresía | `InternalStaff`, `AirlineClient` |
| Portal de rol | `BackOffice`, `RampMobileApp`, `AirlinePortal` |

Estos valores no definen por sí solos las transiciones ni la interacción entre estados. Por ejemplo, el modelo no especifica todavía si una cuenta activa con membresía suspendida puede conservar algún permiso de lectura.

## Lo que ya existe y lo que falta

Existe el esquema para cuentas ASP.NET Identity, roles, permisos, membresías y scopes. El seeder de Development crea anclas sintéticas mínimas para los tres portales, pero no constituye el catálogo definitivo de roles ni datos reales.

La API actual no implementa autenticación ni endpoints de negocio. Por ello, las reglas anteriores son invariantes de arquitectura que los futuros casos de uso deben materializar y probar, especialmente aislamiento entre organizaciones y estaciones.

## Pruebas obligatorias futuras

- una cuenta de aerolínea nunca observa ni modifica otra organización;
- cero membresías válidas o varias membresías activas sin contexto inequívoco fallan de forma cerrada;
- un scope de estación revocado deja de autorizar inmediatamente;
- un agente no actúa fuera de sus scopes laborales vigentes;
- cuenta deshabilitada, bloqueada o membresía suspendida falla de forma cerrada;
- un recibo móvil con cuenta distinta del binding activo, binding cerrado, cuenta no activa o dispositivo revocado se rechaza, aunque la clave de idempotencia sea nueva;
- estado, `ProcessedAt`, resultado y error del recibo son coherentes, y un reintento devuelve exactamente el resultado persistido sin repetir el comando;
- IDs públicos inexistentes y existentes fuera de scope producen respuestas indistinguibles cuando sea necesario para evitar enumeración;
- auditoría registra decisiones administrativas sin copiar secretos o tokens.

## Relacionados

- [Índice de dominio](README.md)
- [Personal, roles y departamentos](personal-roles-y-departamentos.md)
- [Gobernanza de usuarios por departamento](gobernanza-por-departamento.md)
- [Entidades y relaciones v1](entidades-y-relaciones-v1.md)
- [Brechas y preguntas abiertas](brechas-y-preguntas-abiertas.md)

## Fuentes

- [Decisiones de identidad y tenant](../../docs/architecture/database-v1.md)
- [Configuración EF de identidad](../../database/DevelopmentDB/Elevant.Persistence/Persistence/Configurations/IdentityReferenceConfiguration.cs)
- [Seeder sintético de Development](../../database/DevelopmentDB/Elevant.Persistence/Persistence/Seed/DevelopmentDataSeeder.cs)
- [Regla de seguridad del portal](../../frontend/public-web/README.md)
- [Regla de autorización móvil](../../frontend/mobile-agent/README.md)
