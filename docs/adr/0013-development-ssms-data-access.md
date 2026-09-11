# ADR-0013: Acceso humano SSMS a datos Development

## Estado

Accepted — 2026-09-10. Autoriza una excepción humana solo para Development; no
declara que el rollout del VPS ya fue ejecutado. Production queda fuera de
alcance.

## Contexto

El equipo necesita observar el esquema vivo y crear, modificar o eliminar datos
sintéticos durante las pruebas. El flujo exclusivo por API impide algunos
experimentos útiles, mientras que publicar SQL Server o compartir una cuenta
administrativa ampliaría innecesariamente la superficie y permitiría saltarse
el control de migraciones.

ADR-0008 rechazó un Service SQL como parte del despliegue inicial. Esta decisión
reemplaza únicamente esa ausencia para el acceso humano Development aquí
definido. Conserva la prohibición de `1433` público, Funnel, subnet routes y
acceso SQL directo de cualquier cliente ELEVANT.

## Decisión

- Mantener el contenedor SQL sin `ports` y únicamente en la red interna
  `elevant-dev-data`.
- Ejecutar un gateway HAProxy separado, inmutable y sin credenciales, conectado
  a `elevant-dev-data` para alcanzar SQL y a una bridge no interna exclusiva
  `elevant-dev-sql-tools-runtime` para materializar la publicación únicamente
  en `127.0.0.1:11433`. SQL no pertenece a la segunda red.
- Exponer el gateway como `svc:elevant-dev-sql-tools`, endpoint Tailscale
  `tcp:1433`; solo `group:elevant-db-editors` y operaciones reciben acceso.
- Usar logins personales `elevant_dev_erick`, `elevant_dev_eliezer` y
  `elevant_dev_laisha`, sin cuenta humana compartida.
- Conceder mediante `elevant_dev_team_editor` `SELECT`/`INSERT`/`UPDATE`/`DELETE`
  en los esquemas de negocio y solo lectura en `infra`/`audit`. No conceder DDL,
  ejecución general de lógica de negocio, administración, migración, backup,
  restore ni roles privilegiados. El instalador opcional de diagramas puede
  conceder únicamente los objetos auxiliares exactos que necesita SSMS.
- Crear y verificar esas identidades con un one-shot de la imagen db-ops
  aprobada y credenciales root-only; no modificar para ello el Compose
  certificado de SQL ni almacenar secretos en Git.
- Mantener EF Core y Database CD como única ruta para tablas, columnas, claves
  foráneas, índices, constraints e historial de migraciones.
- Instalar el soporte auxiliar de Database Diagrams solo mediante un one-shot
  DBA explícito; el diseñador no autoriza guardar cambios estructurales.

## Consecuencias

- Los desarrolladores pueden experimentar directamente con datos sintéticos y
  omitir deliberadamente reglas de flujo de la API; las constraints SQL siguen
  vigentes.
- La combinación de identidad Tailscale e identidad SQL limita y separa acceso,
  pero no instala un historial DML durable. Auditoría detallada requiere otra
  decisión.
- La pérdida o baja de una cuenta se contiene retirando su membresía Tailscale y
  deshabilitando su login; el Service y gateway pueden retirarse sin recrear SQL
  ni tocar sus volúmenes.
- Frontends, Mobile Agent, API e integraciones conservan la API como única
  interfaz de datos. Production no hereda gateway, usuarios, permisos,
  certificado ni diagramas.

Guías operativas:
[`docs/security/database-access.md`](../security/database-access.md),
[`docs/deployment/dokploy-configuration.md`](../deployment/dokploy-configuration.md)
y
[`ops/dokploy/sql-tools-gateway/README.md`](../../ops/dokploy/sql-tools-gateway/README.md).
