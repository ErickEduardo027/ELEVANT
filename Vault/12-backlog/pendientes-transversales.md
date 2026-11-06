---
id: backlog-pendientes-transversales
title: "Pendientes transversales: dependencias y prueba de cierre"
type: backlog
area: backlog
status: verified
maturity: evolving
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-09-16"
verified_commit: "0ce3355ded1251cebdbe8050f33218c3e27416ae"
sources:
  - docs/deployment/development-hardening-backlog.md
  - docs/deployment/environments.md
  - .github/BRANCH_PROTECTION.md
  - .github/workflows/mobile-ci.yml
  - Vault/00-inicio/roadmap-del-vault.md
  - Vault/02-producto/preguntas-abiertas.md
  - Vault/03-dominio/brechas-y-preguntas-abiertas.md
  - Vault/07-entrega/mobile-apk-ci-cd.md
  - Vault/09-operaciones/observabilidad-y-alertas.md
  - Vault/10-seguridad/riesgos-y-controles-pendientes.md
tags:
  - backlog
  - dependencias
  - aceptacion
  - decisiones
---

# Pendientes transversales

Esta matriz es un **índice de brechas verificables**, no una lista de tareas ya aprobadas ni un calendario. El owner aquí es el equipo hasta que una decisión designe un responsable por rol. El estado de cada capacidad se confirma en la fuente enlazada, no por la sola presencia de una fila.

| Brecha o decisión | Dependencia antes de ejecutar | Prueba mínima para cerrarla | Fuente dueña |
| --- | --- | --- | --- |
| Primer caso de uso real, identidad y permisos | Acordar actor, resultado, tenant/estación, estados y denegaciones | API/contrato, pruebas negativas, cliente consumidor y evidencia de recorrido completo | [Producto](../02-producto/preguntas-abiertas.md) y [Dominio](../03-dominio/brechas-y-preguntas-abiertas.md) |
| Sustituir mocks de los tres clientes | Caso de uso y contrato OpenAPI aprobados; adapter y estados de error | Pruebas de integración y aislamiento, sin usar fixtures como datos reales | [Aplicaciones](../05-aplicaciones/README.md) |
| Mobile APK de Development | Integración .NET, alcance offline, identidad, firma, canal y dispositivos | CI móvil activo, APK firmada trazable, distribución restringida y aceptación en tablet | [Diseño APK](../07-entrega/mobile-apk-ci-cd.md) |
| Alertas externas y heartbeats | Canal/proveedor, privacidad, periodos, responsables y prueba controlada | Detección de fallo y silencio para SQL y cada carril, sin duplicar jobs | [Hardening](../../docs/deployment/development-hardening-backlog.md) |
| Protección técnica de ramas | Plan y permisos GitHub compatibles, checks estables y política de excepción | Push directo, PR sin aprobación y check fallido efectivamente bloqueados | [Protección de ramas](../../.github/BRANCH_PROTECTION.md) |
| Simulacros periódicos de recuperación | Política de frecuencia, alcance, custodio y entorno seguro | Ensayo fechado con restauración, RPO/RTO medidos y acciones correctivas | [Backups](../09-operaciones/backups-y-restore-check.md) y [recuperación](../09-operaciones/mantenimiento-reboot-y-recuperacion.md) |
| Production | Plan independiente, secretos, datos, red, backup, monitoreo y aprobación | Infraestructura y gates propios, aceptación de seguridad y restauración; jamás inferirla de Development | [Ambientes](../../docs/deployment/environments.md) |
| Contract de empleados (ADR-0017) | Todas las cuentas internas con expediente y clientes web publicados que envían `employeeId` | Solicitudes escritas a mano rechazadas, creación directa de miembros y alta móvil heredada retiradas, `employee_id` obligatorio en solicitudes nuevas | [ADR-0017](../../docs/adr/0017-employees-positions-and-access.md) |
| Contract de los comandos comerciales (ADR-0037) | Private Web y Public Web publicadas con las versiones que siempre envían `Idempotency-Key` y la versión esperada | Los comandos que hoy aceptan llamadas sin clave o sin versión las rechazan, y el `DELETE` obsoleto del catálogo sale del contrato OpenAPI | [ADR-0037](../../docs/adr/0037-commercial-cycle-requests-drafts-amendments-and-portal-accounts.md) |
| Restablecer la clave de usuarios internos | Registrar en la API los proveedores de tokens de Identity, o asignar la contraseña temporal sin token, como ya hace Clientes | `POST governance/departments/{department}/users/{id}/password-reset` y `POST governance/users/{id}/password-reset` asignan la contraseña temporal, el primer ingreso exige cambiarla y una prueba de integración cubre ambas rutas | [ADR-0037](../../docs/adr/0037-commercial-cycle-requests-drafts-amendments-and-portal-accounts.md) y [Gobernanza por departamento](../03-dominio/gobernanza-por-departamento.md) |
| Correo de contratos (revisión docente) | Proveedor de correo, plantillas y consentimiento; hoy el PDF se descarga y se firma en la aplicación | Envío del PDF a la aerolínea al aprobar y al firmar, con reintento y auditoría | [Correcciones de la revisión](../05-aplicaciones/correcciones-revision-docente-2026-10.md) |
| Posiciones combinadas (9-Alfa, 32-Bravo) | Definir en datos qué posiciones se bloquean entre sí | La API rechaza ocupar una posición bloqueada por su combinada y el mapa lo muestra | [Correcciones de la revisión](../05-aplicaciones/correcciones-revision-docente-2026-10.md) |
| Notificaciones fuera de la aplicación | Canal (correo o push del navegador) y preferencias por usuario | Una alerta llega con la aplicación cerrada y respeta las preferencias | [ADR-0019](../../docs/adr/0019-menu-option-permissions-and-department-notifications.md) |
| Historia anterior a Git | Entrevista consentida y fuente contemporánea si existe | Testimonio fechado atribuido por rol, incertidumbres separadas de hechos | [Orígenes](../01-historia/origenes-y-limites-de-evidencia.md) |

Las filas «Contract de los comandos comerciales» y «Restablecer la clave de
usuarios internos» se añadieron el 6 de noviembre de 2026, después del commit
verificado de esta nota; describen el código de la fase 1 del ciclo
(`8a79fe70`).

## Cómo convertir una fila en trabajo

1. Registrar decisión, alcance y owner por rol en el área dueña; separar diseño de autorización de ejecución.
2. Definir riesgo, precondiciones, prueba negativa, criterio de aceptación y rollback cuando aplique.
3. Implementar en un PR desde `Development`, con fuentes ejecutables y documentación actualizadas.
4. Aceptar el despliegue por el operador si cambia el VPS o el acceso; conservar sólo evidencia saneada.
5. Revalidar la nota del Vault y retirar la fila sólo cuando otra nota vigente y verificable cuente el resultado.

No hay fechas ni un orden global aprobado para estas filas. Las dos brechas de hardening tienen prioridad alta en su [fuente](../../docs/deployment/development-hardening-backlog.md), lo que no autoriza activarlas sin sus dependencias y pruebas.

Volver al [Índice de Backlog](README.md) o a la [política de evidencia](../08-gobernanza/fuentes-y-evidencia.md).
