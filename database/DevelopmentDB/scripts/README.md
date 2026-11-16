# Scripts SQL operativos

Solo contiene tareas que no pertenecen a una migración EF: crear el contenedor físico/marcador, administrar identidades de Development y verificar backup/restore.

Cada script debe declarar ambiente, precondiciones, target exacto y verificación. Se ejecuta con `sqlcmd -b` para que un error produzca exit code no-cero. Las credenciales llegan como variables/secretos y nunca se imprimen o incrustan.

No añadir DML de negocio, resets generales o scripts manuales que alteren el esquema administrado por EF.

Las excepciones auxiliares de Development deben ser explícitas y aisladas. El acceso
humano se provisiona con `provision-development-team-access`, que solo administra
logins, usuarios, roles y permisos. La reconciliación transaccional sustituye los
logins con SID nuevo, remapea únicamente los usuarios Development y requiere que las
sesiones SSMS personales estén cerradas. Los objetos `dbo.sysdiagrams` requeridos por SSMS
se instalan aparte con `install-development-diagram-support`; no forman parte de la
historia EF ni conceden DDL a los editores.
El verificador fail-closed también obliga a revisar cualquier objeto no-tabla en los
esquemas CRUD, cascada hacia `infra`/`audit` o tabla system-versioned cuyo historial
viva en uno de esos esquemas protegidos.
