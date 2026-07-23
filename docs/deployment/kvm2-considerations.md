# Consideraciones para KVM 2

KVM 2 se trata como un perfil de servidor con recursos finitos, no como una garantía de capacidad. Las especificaciones comerciales pueden cambiar; antes de desplegar se verifica en el contrato vigente CPU, RAM, almacenamiento, transferencia, virtualización, región y política de backup.

Inicialmente alojará Dokploy, reverse proxy, Elevant API, Elevant Web, SQL Server,
SignalR, servicios en segundo plano, monitoreo básico y backups controlados.

Mobile Agent no se alojará como una web en el VPS:

```text
se compila la APK
        ↓
se instala en la tablet
        ↓
consume por HTTPS la API alojada en el KVM
```

## Capacidad

En el mismo host competirían sistema operativo, Docker, Dokploy, proxy, API, SQL Server, logs y backups temporales. SQL Server suele dominar memoria y almacenamiento. No se fijan límites rígidos en este scaffold porque dependen de las características reales del servidor. Antes de Production se debe limitar la memoria de SQL Server, conservar margen para picos y medir con carga representativa.

No se habilitan réplicas múltiples, workers o herramientas pesadas por defecto. Si memoria, IOPS o CPU sostienen saturación, se optimiza y después se escala o separa la base; no se oculta el problema reiniciando servicios.

## Almacenamiento

- Separar volumen de datos de capas efímeras de contenedor.
- Vigilar espacio, IOPS y crecimiento de logs.
- Mantener backups cifrados fuera del host y del proveedor primario cuando sea posible.
- Probar restauración en infraestructura aislada.
- Evitar que imágenes y artefactos antiguos consuman todo el disco.
- No guardar fotografías o videos grandes indefinidamente en el disco del VPS.
- Monitorear RAM, CPU, almacenamiento y crecimiento de imágenes Docker.

## Red y endurecimiento

Exponer solo los puertos necesarios para HTTPS y administración controlada. SQL Server permanece en red privada y el puerto 1433 nunca se publica. Usar HTTPS, firewall, actualizaciones, SSH con llave, cuenta no root, protección del panel y rotación de credenciales. Confirmar zona horaria del host, pero guardar fechas de aplicación en UTC.

## Continuidad

Un único KVM es un punto de fallo. Documentar RPO/RTO antes de almacenar datos reales, automatizar backup externo, conservar configuración reproducible y ensayar reconstrucción. Dokploy simplifica despliegue, pero no sustituye alta disponibilidad ni recuperación ante desastre.
