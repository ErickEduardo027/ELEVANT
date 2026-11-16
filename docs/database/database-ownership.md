# Propiedad de la base de datos

La API Elevant es la única propietaria de su base SQL Server. Web, Mobile Agent, herramientas de analítica e integraciones no reciben acceso directo a tablas; consumen contratos autorizados.

## Responsabilidades del backend

- definir el esquema en `Elevant.Persistence` y aplicarlo mediante una operación
  explícita de release; la API no migra ni siembra al arrancar;
- mantener invariantes y transacciones;
- limitar permisos de la identidad de aplicación;
- exponer datos mínimos mediante API;
- registrar operaciones administrativas sin revelar contenido sensible;
- definir retención, respaldo y eliminación cuando existan datos reales.

## Herramientas humanas

SSMS no forma parte del runtime. En Development, cuentas personales controladas
pueden usarlo por el Service Tailscale aprobado para ejecutar CRUD sobre datos
sintéticos; no reciben DDL ni propiedad del esquema. Esta excepción humana no
autoriza a un frontend, Mobile Agent, integración o herramienta compartida a
conectarse directamente.

Las consultas manuales en Production son excepcionales, de preferencia solo
lectura, aprobadas y registradas. Production no hereda el gateway ni las cuentas
CRUD de Development. No se copian resultados a chats, issues o repositorio.

## Separación

Local y Development separan bases, usuarios, credenciales, volúmenes y backups.
Production es un límite futuro reservado: cuando se apruebe tendrá recursos
independientes y aplicará la misma cadena de migraciones de esquema, sin seed
de negocio. No se restaurará un backup de Production en Development; se emplean
datos sintéticos.

El puerto 1433 local se liga a loopback cuando sea necesario. En servidores no se publica a Internet y el acceso administrativo se restringe por red, firewall y credencial separada.
