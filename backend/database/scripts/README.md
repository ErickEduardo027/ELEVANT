# Scripts SQL operativos

Solo contiene tareas que no pertenecen a una migración EF: crear el contenedor físico/marcador, administrar identidades de Development y verificar backup/restore.

Cada script debe declarar ambiente, precondiciones, target exacto y verificación. Se ejecuta con `sqlcmd -b` para que un error produzca exit code no-cero. Las credenciales llegan como variables/secretos y nunca se imprimen o incrustan.

No añadir DML de negocio, resets generales o scripts manuales que alteren el esquema administrado por EF.
