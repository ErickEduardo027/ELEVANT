# Acceso seguro a la base de datos

SQL Server no se expone a Internet. La API accede desde `elevant-dev-data` con
una identidad de runtime y permisos mínimos. La cuenta `sa`, el migrador y las
identidades operativas nunca se usan como credenciales normales de aplicación o
de una persona.

Development admite además acceso humano permanente por SSMS para trabajar con
datos sintéticos. Es una excepción controlada para el equipo de desarrollo; no
convierte SQL Server en una interfaz de los clientes y no aplica a Production.

## Identidades

- Runtime API: lectura/escritura únicamente sobre objetos requeridos.
- Migraciones: permisos de esquema, usados solo por Database CD.
- Seeder, health, backup y restore: identidades separadas para su operación.
- Administración: cuenta controlada de operaciones, usada solo en checkpoints.
- Equipo Development: cuentas personales `elevant_dev_erick`,
  `elevant_dev_eliezer` y `elevant_dev_laisha`; su única membresía explícita es
  `elevant_dev_team_editor` (todo usuario conserva el rol implícito `public`).

No se comparten identidades entre Local, Development y Production. Cada persona
recibe una contraseña diferente por un canal privado; las contraseñas, cadenas
de conexión y correos reales nunca se escriben en Git, Dokploy Scripts, chats o
capturas. Dar de baja a una persona implica retirar su membresía Tailscale y
deshabilitar su login SQL individual, sin rotar las cuentas de los demás.

## Permisos humanos en Development

`elevant_dev_team_editor` puede ejecutar `SELECT`, `INSERT`, `UPDATE` y `DELETE`
sobre las tablas de negocio en los esquemas `iam`, `ref`, `hr`, `commercial`,
`ops` e `integration`. Los esquemas técnicos `infra` y `audit` son de solo
lectura. Las concesiones son por esquema para que una tabla de negocio nueva,
creada por una migración aprobada, herede el mismo contrato sin convertir el rol
en propietario de la base.

El rol no recibe `db_owner`, `db_ddladmin`, `db_securityadmin`, `sysadmin` ni
`dbcreator`; tampoco puede ejecutar `CREATE`, `ALTER`, `DROP`, administrar
logins/roles, aplicar migraciones, hacer backup/restore ni cambiar
`infra.__EFMigrationsHistory` o los marcadores del ambiente. La comprobación de
permisos positivos y negativos forma parte de CI y del rollout.

Como el CRUD se concede por esquema para abarcar tablas EF futuras, esos seis
esquemas no pueden incorporar vistas, sinónimos, funciones, secuencias ni
triggers sin una decisión de acceso adicional. Esos objetos podrían ampliar el
grant o encadenar operaciones hacia un esquema protegido; la verificación
fail-closed de Database CD los rechaza hasta que su comportamiento y permisos
se modelen explícitamente.

La misma verificación rechaza una foreign key con cascada desde una tabla
editable hacia `infra` o `audit`, y una tabla `SYSTEM_VERSIONED` editable cuyo
historial se escriba en cualquiera de esos esquemas protegidos. Así, un CRUD
permitido no puede producir indirectamente una escritura técnica de solo
lectura.

El CRUD directo desde SSMS omite intencionalmente las validaciones y reglas de
flujo de la API: sirve para preparar, explorar y romper datos sintéticos durante
el desarrollo. SQL Server sí conserva sus invariantes físicas, por ejemplo
foreign keys, `NOT NULL`, índices únicos y `CHECK`. Un cambio de tabla, columna,
tipo, índice, constraint o clave foránea no es CRUD y siempre se entrega como
migración EF Core revisada por PR y aplicada por Database CD.

Las cuentas individuales permiten identificar al principal de una conexión,
pero este cambio no instala historial DML durable ni captura el contenido
anterior/posterior de cada fila. Si el equipo necesita esa trazabilidad deberá
aprobar SQL Server Audit u otro mecanismo separado antes de afirmar que las
escrituras quedan auditadas.

## Red privada

El contenedor SQL continúa sin `ports` y solo pertenece a `elevant-dev-data`.
Un recurso independiente `elevant-dev-sql-tools-gateway` reenvía TCP sin
credenciales y publica únicamente `127.0.0.1:11433` en el VPS. Tailscale Serve
presenta ese loopback como `svc:elevant-dev-sql-tools`, endpoint `tcp:1433`.

Solo `group:elevant-db-editors` y operaciones reciben grant al Service. El host
no concede acceso directo a `tag:elevant-dev-host:1433` ni `:11433`; no se
anuncia una subnet Docker, no se habilita Funnel y los firewalls siguen
bloqueando SQL desde Internet. El gateway no sustituye autenticación SQL:
Tailscale decide quién alcanza el endpoint y SQL Server decide qué puede hacer
cada login. La membresía `elevant-db-editors` concede solo SQL Tools; el acceso
a API y webs continúa dependiendo de `group:elevant-dev`.

## Conexión desde SSMS

Antes de abrir SSMS, inicie sesión en Tailscale con su identidad personal y
confirme que `elevant-dev-sql-tools` es alcanzable. Use estos campos:

| Campo SSMS | Valor Development |
| --- | --- |
| Server type | `Database Engine` |
| Server name | `elevant-dev-sql-tools.<TAILNET_DNS_NAME>.ts.net,1433` |
| Authentication | `SQL Server Authentication` |
| Login | la cuenta `elevant_dev_<persona>` asignada |
| Password | la contraseña personal entregada fuera de Git |
| Database | `ElevantDevelopmentDb` |
| Encryption | `Mandatory` |
| Trust server certificate | habilitado solo para este Development actual |

No use la IP pública, la IP Tailscale del host, `localhost`, `sa`,
`elevant_dev_app`, el migrador ni una cuenta compartida. No guarde la contraseña
en un archivo del repositorio. La confianza temporal en el certificado de
Development no establece una política para Production.

## Escrituras de prueba

Antes de un cambio amplio, examine el conjunto exacto y pruebe con rollback:

```sql
SET XACT_ABORT ON;
BEGIN TRANSACTION;

-- INSERT, UPDATE o DELETE de datos sintéticos.

-- Compruebe filas y relaciones antes de elegir una sola salida:
ROLLBACK TRANSACTION;
-- COMMIT TRANSACTION;
```

No deje transacciones abiertas ni desactive constraints para conseguir que una
escritura pase. Si el experimento requiere cambiar una estructura, deténgalo y
cree una migración. Aunque Development sea descartable, no inserte PII,
credenciales ni copias de Production y no publique resultados en chats, issues
o capturas.

## Diagramas de SSMS

La primera apertura de **Database Diagrams** solicita instalar objetos auxiliares
como `dbo.sysdiagrams`. Ese bootstrap es una mutación de esquema y el equipo de
operaciones lo ejecuta una sola vez mediante el artefacto revisado; nunca se
entrega `db_owner` temporal al desarrollador. Después, cada integrante crea y
guarda su diagrama con su propia cuenta.

El diseñador se usa para visualizar. Si propone una modificación de tabla,
columna, relación o índice, se cancela: la modificación se implementa en
`database/DevelopmentDB/Elevant.Persistence/Persistence/Migrations`, pasa CI y
llega al VPS por Database CD. Los objetos auxiliares del diseñador se verifican
por separado y no sustituyen el modelo EF.

## Operación y Production

- revisar periódicamente cuentas inactivas, membresías y permisos efectivos;
- conservar cifrado de transporte y backups del ambiente;
- probar recuperación sin sobrescribir el origen;
- registrar metadatos de operación, no contenido sensible;
- retirar primero el Service/gateway o deshabilitar el login ante una anomalía;
- no relajar firewall, cifrado o autenticación para resolver conectividad.

Production queda expresamente fuera de este contrato. No hereda el gateway, el
grupo Tailscale, las cuentas, los permisos CRUD, la confianza del certificado ni
los diagramas de Development. Su acceso administrativo requiere un diseño y una
aprobación independientes.
