# Backlog de hardening de Development

Este documento registra exclusivamente dos controles diferidos del ambiente
Development. No autoriza cambios en el VPS, Dokploy, Tailscale o GitHub y no
convierte una tarea pendiente en un control existente.

| Control | Estado | Prioridad |
| --- | --- | --- |
| Alertas externas y heartbeats operativos | Diferido | Alta |
| Proteccion y gobernanza de ramas | Diferido | Alta |

## 3. Alertas externas y heartbeats operativos

### Estado actual

- Beszel envia el heartbeat base del Hub y permite observar recursos del host.
- Beszel no recibe el socket Docker y, por diseno, no inventaria contenedores ni
  observa su health o sus logs.
- SQL health y los seis carriles programados no tienen checks externos
  independientes: Database backup, Database restore-check, Database poll, API
  poll, AVIAM poll y Public poll. Sus fallos se detectan mediante revision
  diaria de Beszel, Dokploy Schedules y `controller.log`.
- El canal externo de notificaciones y los umbrales de Beszel siguen diferidos.
  Por tanto, no se declara cobertura automatica de alertas de base de datos o
  contenedores.

El contrato vivo y sus limites estan descritos en
[Configuracion de Dokploy](dokploy-configuration.md) y
[Observabilidad privada](../../ops/dokploy/observability/README.md).

### Dependencias

- Aprobacion del operador para el proveedor y el canal externo de
  notificaciones, incluidos sus requisitos de privacidad y retencion.
- Un responsable operativo y una ruta de escalamiento para cada alerta.
- Almacenamiento de URLs, tokens y demas credenciales solo en variables
  protegidas o en el gestor de secretos; ningun valor real se versiona.
- Los seis schedules aceptados, con sus frecuencias, dependencias,
  serializacion por lock y timeout ya validados antes de asociar heartbeats.
- Credencial de GitHub de minimo privilegio, almacenada fuera del repositorio,
  si se aprueba publicar commit statuses desde los controladores.
- Ventana controlada para probar alertas sin ejecutar una segunda operacion SQL
  ni confundir una prueba con un backup o restore-check real.

### Criterios de aceptacion

El control puede pasar a **aceptado** solo cuando:

1. existe un heartbeat/dead-man independiente para SQL health y para cada uno de
   los seis carriles: DB backup, DB restore-check, DB poll, API poll, AVIAM poll
   y Public poll;
2. cada check tiene periodo y gracia coherentes con su schedule y con el timeout
   maximo del job, sin jobs duplicados para compensar fallos;
3. inicio, exito, fallo y ausencia de ejecucion se distinguen sin incluir
   secretos ni salida SQL sensible; un poll no-op aceptado cuenta como exito y
   no como ausencia de trabajo;
4. las promociones publican, cuando aplique, commit statuses estables para
   `succeeded`, `failed` y `no-op`, vinculados al commit/run y sin convertir el
   token en argumento, log o estado versionado;
5. una prueba controlada de fallo y otra de ejecucion ausente por cada tipo de
   carril llegan al responsable por el canal externo aprobado;
6. el heartbeat base de Beszel continua vigente y una alerta de host caido se
   recibe dentro del tiempo acordado;
7. se conserva evidencia saneada de fecha, check, resultado y receptor, y se
   actualizan los runbooks sin copiar URLs o tokens reales;
8. se documenta como limitacion que Beszel sigue sin visibilidad de contenedores
   mientras no exista una interfaz Docker de solo lectura con allowlist
   expresamente revisada.

Una notificacion de GitHub o un commit status puede complementar esta cobertura,
pero no sustituye los heartbeats de las operaciones ejecutadas en el VPS.

## 4. Proteccion y gobernanza de ramas

### Estado actual

- El repositorio privado usa un plan que no permite imponer las reglas de
  proteccion requeridas para este flujo.
- Un colaborador con escritura puede hacer push directo a `Development` y
  modificar workflows capaces de producir candidatos de despliegue.
- La revision por pull request es una norma del equipo, no una barrera tecnica.
- Artefactos inmutables, validaciones fail-closed, backups y locks reducen el
  impacto, pero no sustituyen una aprobacion obligatoria antes del merge.

La configuracion objetivo y la limitacion temporal estan registradas en
[Proteccion de ramas](../../.github/BRANCH_PROTECTION.md). La relacion con los
carriles CD se resume en
[Configuracion de Dokploy](dokploy-configuration.md).

### Dependencias

- Un plan de GitHub que permita aplicar rulesets o protected branches al
  repositorio privado.
- Equipos, propietarios y administradores reales definidos fuera de las
  plantillas del repositorio.
- Nombres estables de los checks requeridos para backend, base, API, webs y
  operaciones.
- Responsable autorizado para aplicar las reglas en GitHub y conservar
  evidencia saneada de su configuracion.
- Procedimiento de excepcion de emergencia limitado, temporal y auditable.

### Criterios de aceptacion

El control puede pasar a **aceptado** solo cuando:

1. `Development` exige pull request y los checks correspondientes al area
   modificada, y bloquea force-push y eliminacion;
2. migraciones, seguridad e infraestructura requieren revision humana;
3. `main` exige pull request, al menos una aprobacion, conversaciones resueltas,
   invalidacion de aprobaciones obsoletas, rama actualizada y el check de
   restore/build/test cuando el backend esta en alcance;
4. `main` bloquea force-push y eliminacion, y las excepciones quedan restringidas
   a administradores designados y auditables;
5. una prueba demuestra que un escritor no puede hacer push directo, que un PR
   sin aprobacion no puede fusionarse y que un required check fallido bloquea el
   merge;
6. los workflows que publican artefactos o activan CD quedan cubiertos por la
   misma gobernanza y sus cambios no pueden eludir la revision requerida;
7. la evidencia registra ruleset, ramas, checks y resultado de las pruebas sin
   incluir identidades personales, correos, tokens ni otros secretos.

Los commit statuses del controlador, si se habilitan, son evidencia adicional
del despliegue; no reemplazan required checks, revisiones ni restricciones de
push.

## Cierre del backlog

Cada control se cierra mediante un PR separado que actualiza su documentacion y
adjunta evidencia saneada. Un control no se marca aceptado por haber creado la
configuracion: primero deben pasar todos sus criterios, incluida la prueba real
de fallo. Si una prueba falla, se conserva el estado **diferido** y el mecanismo
nuevo permanece deshabilitado o se revierte segun su runbook.
