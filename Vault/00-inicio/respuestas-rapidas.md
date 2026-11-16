---
id: inicio-respuestas-rapidas
title: "Respuestas rápidas"
type: guide
area: vault
status: verified
maturity: evolving
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-09-12"
verified_commit: "c2a060179983a13b7e5a0dd45cba1a1fd2e54e8a"
sources:
  - AGENTS.md
  - README.md
  - docs/README.md
  - docs/api/consumer-guidelines.md
  - docs/api/openapi-contract.md
  - docs/architecture/database-v1.md
  - docs/architecture/system-overview.md
  - docs/database/migrations.md
  - docs/deployment/development-hardening-backlog.md
  - docs/deployment/dokploy.md
  - docs/deployment/environments.md
  - docs/security/database-access.md
  - docs/workflows/git-workflow.md
  - docs/workflows/local-development.md
  - docs/workflows/mobile-workflow.md
  - docs/workflows/pull-requests.md
  - docs/workflows/release-workflow.md
  - Vault/01-historia/README.md
  - Vault/02-producto/README.md
  - Vault/03-dominio/README.md
  - Vault/04-arquitectura/README.md
  - Vault/05-aplicaciones/README.md
  - Vault/06-desarrollo/README.md
  - Vault/07-entrega/README.md
  - Vault/09-operaciones/README.md
  - Vault/10-seguridad/README.md
  - Vault/11-referencia/README.md
  - Vault/12-backlog/README.md
tags:
  - inicio
  - faq
  - navegacion
---

# Respuestas rápidas

Esta página responde lo esencial y te lleva a la evidencia. Si una respuesta depende de un estado operativo en tiempo real, aquí encontrarás el procedimiento o la fuente, no una garantía de disponibilidad presente.

## Producto y arquitectura

### ¿Qué es ELEVANT?

Es la plataforma de AVIAM para planificar y controlar asistencia en tierra. El monorepo contiene una aplicación interna, un portal público/cliente, una aplicación nativa para agentes y el backend compartido. Consulta el [Mapa de Producto](../02-producto/README.md), el [README principal](../../README.md) y la [arquitectura del sistema](../../docs/architecture/system-overview.md).

### ¿Cuál es el recorrido operativo principal?

*Posterior al commit verificado de esta nota (código de `39a85a46`):* el ciclo tiene cuatro fases: comercial (solicitud, alta y contrato), pre-operación (vigencia, firmas, permiso, personal y turnos), operación (planificación, ejecución en rampa y revisión OCC) y facturación y cobro (e-CF simulado, tarjeta simulada, notas, cuentas por pagar y gastos). Cada fase tiene casos de uso en la API; [Recorridos de extremo a extremo](../02-producto/recorridos-end-to-end.md) nombra sus operaciones y el [Mapa de Dominio](../03-dominio/README.md) fija el vocabulario canónico.

### ¿Desde cuándo existe ELEVANT y cómo evolucionó?

La historia reproducible comienza en el primer commit disponible; cualquier origen anterior permanece explícitamente desconocido hasta contar con testimonio y evidencia. El [Índice de Historia](../01-historia/README.md) separa hitos Git, prototipo, consolidación de arquitectura y operación Development.

### ¿Hay un backend o una base por aplicación?

No. La arquitectura establece una sola API y una sola base lógica por ambiente para los tres clientes. *Posterior al commit verificado de esta nota (código de `39a85a46`):* los tres clientes, Mobile Agent incluido, consumen los endpoints versionados con el cliente compartido. Crear un backend o una base por cliente contradice la arquitectura vigente. Fuente: [`AGENTS.md`](../../AGENTS.md) y [Flujo Mobile](../../docs/workflows/mobile-workflow.md).

### ¿Qué recorrido funciona hoy de extremo a extremo en la API real?

*Posterior al commit verificado de esta nota (código de `39a85a46`):* las cuatro fases del ciclo, de la solicitud pública al cobro con tarjeta, con sesión JWT y 400 operaciones en OpenAPI. El e-CF y la pasarela son simulaciones sin validez fiscal, y el repositorio no acredita qué versión corre en el VPS. Consulta [Mapa de capacidades](../02-producto/mapa-de-capacidades.md), [Arquitectura](../04-arquitectura/README.md), [API compartida](../05-aplicaciones/api-compartida.md) y [Mapa de Aplicaciones](../05-aplicaciones/README.md) antes de inferir capacidad desde una pantalla o tabla.

### ¿Puede un frontend consultar SQL Server directamente?

No. Ningún cliente puede consultar SQL Server directamente; *posterior al commit verificado de esta nota (código de `39a85a46`),* Private Web, Public Web y Mobile Agent acceden mediante la API. El acceso SSMS de Development es una herramienta controlada para personas autorizadas y no un contrato de aplicación. Consulta [Acceso a base de datos](../../docs/security/database-access.md).

### ¿Qué define el contrato cliente/servidor?

OpenAPI cuando el endpoint existe. Las entidades EF no son DTO HTTP y los mocks no son contratos. Consulta [Contrato OpenAPI](../../docs/api/openapi-contract.md) y [Guía de consumidores](../../docs/api/consumer-guidelines.md).

### ¿Qué define el esquema de base de datos?

La historia de migraciones EF Core en `database/DevelopmentDB/Elevant.Persistence/Persistence/Migrations`. Para cambiarla, empieza por [Migraciones](../../docs/database/migrations.md) y [Arquitectura Database v1](../../docs/architecture/database-v1.md).

### ¿Dónde veo todas las capas y aplicaciones juntas?

Usa el [lienzo Arquitectura · Aplicaciones · Desarrollo](../diagrams/arquitectura-aplicaciones-desarrollo.md). Su Canvas permite recorrer tarjetas y su Base ofrece vistas filtrables sin depender del gráfico.

## Desarrollo

### ¿Desde qué rama empiezo?

Desde `Development`, en una rama feature. El merge es manual mediante PR; no trabajes directamente en `Development` o `main`. Consulta [Git workflow](../../docs/workflows/git-workflow.md) y [Pull requests](../../docs/workflows/pull-requests.md).

### ¿Qué debo leer antes de cambiar código?

El [`AGENTS.md`](../../AGENTS.md) raíz y el más cercano al subárbol. Después, el perfil de la [aplicación](../05-aplicaciones/README.md), el README del producto, sus contratos y sus pruebas. La secuencia completa está en el [Mapa de Desarrollo](../06-desarrollo/README.md).

### ¿Puedo reutilizar datos del prototipo como seed?

No. Fixtures del frontend, almacenamiento del navegador y datos de `backend-prototipo` son desechables. No se copian credenciales, PII ni datos reales a seeds o Production.

### ¿Cómo sé qué pruebas ejecutar?

Cada subárbol posee sus comandos. El backend usa la solución y manifests .NET bloqueados; cada frontend usa su propio `package-lock.json` y scripts npm. Consulta [Comandos locales por subárbol](../06-desarrollo/comandos-locales-por-subarbol.md), [Pruebas y frontera CI](../06-desarrollo/pruebas-calidad-y-frontera-ci.md) y el README/`AGENTS.md` del área.

### ¿Cómo cambio un endpoint o el cliente TypeScript?

Implementación, OpenAPI, snapshot, cliente generado, tests y consumidores afectados deben evolucionar juntos. No edites la salida generada a mano. Sigue [OpenAPI y cliente compartido](../06-desarrollo/openapi-y-cliente-compartido.md) y [Cambio seguro por tipo](../06-desarrollo/cambio-seguro-por-tipo.md).

### ¿Cómo cambio una tabla, columna o relación?

Mediante una migración EF aditiva creada con el script revisado; nunca con DDL manual en SSMS ni reescribiendo una migración aplicada. Sigue [Migraciones y datos](../06-desarrollo/migraciones-y-datos.md).

### ¿Cuándo está terminado un cambio?

Cuando el alcance está acotado, pasan las validaciones de todos los límites afectados, no se versionan artefactos/secretos, se actualiza la documentación durable y el handoff declara también qué no se desplegó. Consulta [Definition of Done y handoff](../06-desarrollo/definition-of-done-y-handoff.md).

## CI/CD y ambientes

### ¿Un merge a `Development` se despliega automáticamente?

Para DB, API, Private Web y Public Web existe entrega pull-based dentro del alcance aceptado de Development: el CI publica bundles certificados y los controladores privados los consultan. Que un merge concreto llegue al runtime depende de los gates, schedules y salud actual; no se deduce sólo del merge. Consulta [Cadena de artefactos](../07-entrega/cadena-de-artefactos-y-promocion.md) y [Controladores](../09-operaciones/controladores-schedules-y-promocion.md).

### ¿Un PR sin conflictos garantiza que CI pase?

No. “Sin conflictos” solo significa que Git puede combinar ramas. CI valida compilación, pruebas, contratos y políticas que pueden fallar independientemente. Por norma del equipo, el merge se hace tras revisar los checks aplicables. En el repositorio privado actual esa disciplina no está impuesta por branch protection, así que un push directo sigue siendo técnicamente posible: [límites de revisión](../07-entrega/limites-revision-y-rollback.md).

### ¿El Mobile Agent ya tiene entrega APK automática?

No. La aplicación Expo/React Native existe y la distribución firmada requiere decisiones y configuración adicionales. *Posterior al commit verificado de esta nota (código de `39a85a46`):* el workflow `mobile-ci.yml` valida lint, tipos, pruebas unitarias y el bundle Metro de Android, pero no construye ni firma una APK. Consulta el [diseño diferido de APK](../07-entrega/mobile-apk-ci-cd.md). No se aloja como sitio en Dokploy.

### ¿Production está desplegada?

No. `database/ProductionDB` es una frontera futura reservada. Production necesita otro ambiente, secretos, dominio, observabilidad, backup y aprobación separados. Consulta [Ambientes](../../docs/deployment/environments.md).

### ¿En qué orden se promueve un cambio coordinado?

El orden es migración compatible de DB, luego API y después clientes. Cada artefacto tiene ciclo independiente y debe conservar compatibilidad durante la transición. Consulta [Cadena de artefactos y promoción](../07-entrega/cadena-de-artefactos-y-promocion.md).

## Operación y acceso

### ¿Development está expuesto a Internet?

Los endpoints de control, SQL, Dokploy y monitorización deben permanecer privados mediante Tailscale. “Public Web” describe audiencia funcional; no convierte Development en un servicio público de Internet. Consulta [Perímetro privado](../10-seguridad/perimetro-development-y-acceso-privado.md).

### ¿Cómo veo o modifico datos de Development con SSMS?

Solo mediante la ruta privada aprobada y una identidad SQL individual de mínimo privilegio. El acceso permite CRUD de datos de prueba dentro de los límites asignados; no concede cambios de esquema, backups ni privilegios de infraestructura. Consulta [SQL privado y SSMS](../09-operaciones/sql-privado-y-ssms.md) y [seguridad de identidades](../10-seguridad/identidades-secretos-y-datos-de-prueba.md); nunca guardes la contraseña en el repositorio.

### ¿Dónde veo si una promoción falló?

Primero en los checks de GitHub para CI; después, para CD, en el estado y log del controlador y en los schedules privados de Dokploy. La ausencia de alertas externas automáticas sigue documentada como riesgo: [gates y fallos](../07-entrega/gates-fallos-y-no-op.md) y [observabilidad](../09-operaciones/observabilidad-y-alertas.md).

### ¿Un documento de operaciones me autoriza a ejecutar comandos en el VPS?

No. Las plantillas y runbooks requieren autorización del operador. El cambio se ejecuta manualmente, con un checkpoint verificado por vez, según [`AGENTS.md`](../../AGENTS.md).

## Gobernanza del conocimiento

### ¿Cuál fuente gana si dos documentos discrepan?

Código y tests, migraciones EF, OpenAPI compilado, workflows CI, plantillas/runbooks aceptados, ADR y finalmente prototipos históricos. Revisa los matices en [Política de evidencia](../08-gobernanza/fuentes-y-evidencia.md).

### ¿Cómo documento algo todavía no implementado?

Usa `status: draft` o `status: deferred` y `evidence: planned`. Explica dependencias y criterios de aceptación sin redactarlo en presente. Consulta [Metadatos](../08-gobernanza/metadatos.md).

### ¿Qué hago si la respuesta no está documentada?

Busca la fuente ejecutable, registra `unknown` si no existe evidencia y crea una nota o issue usando la [plantilla general](../99-plantillas/pagina.md). No completes el vacío con una inferencia silenciosa.

### ¿Dónde compruebo una afirmación y veo lo pendiente?

Empieza por el [Índice de Referencia](../11-referencia/README.md), sigue la fuente primaria y comprueba el commit indicado. La [reconciliación de `docs/`](../11-referencia/reconciliacion-docs.md) identifica guías que se corrigieron; el [Backlog transversal](../12-backlog/README.md) registra decisiones y pruebas de cierre todavía pendientes.

## Más rutas

- [Mapa de preguntas](mapa-de-preguntas.md)
- [Estado inicial](estado-inicial.md)
- [Home](home.md)
