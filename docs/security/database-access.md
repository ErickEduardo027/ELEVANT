# Acceso seguro a la base de datos

SQL Server no se expone a Internet. La API accede desde una red privada con una identidad por ambiente y permisos mínimos. La cuenta `sa` o equivalente administrativo no se utiliza como identidad normal de la aplicación.

## Identidades

- Runtime API: lectura/escritura únicamente sobre objetos requeridos.
- Migraciones: permisos de esquema, usados solo por la tarea autorizada.
- Administración: cuenta personal o controlada, con auditoría.
- Backup: permisos limitados al proceso y destino correspondiente.

No se comparten identidades entre Local, Development y Production. La cadena de conexión se entrega como secreto y nunca se imprime completa.

## Red

En desarrollo, un puerto publicado se liga a `127.0.0.1`. En servidores, la base reside en una red de datos interna; el firewall permite únicamente orígenes necesarios. Para SSMS remoto se usa VPN, túnel o bastion aprobado, no un 1433 público.

## Operación

- preferir consultas parametrizadas a SQL concatenado;
- revisar permisos y cuentas inactivas;
- cifrar transporte y backups según el entorno;
- limitar y auditar consultas administrativas;
- no exportar datos reales a dispositivos o Development;
- probar recuperación sin sobrescribir el origen;
- registrar metadatos de operación, no contenido sensible.

Un problema de conectividad no se resuelve deshabilitando firewall, cifrado o validación de certificado de forma permanente.
