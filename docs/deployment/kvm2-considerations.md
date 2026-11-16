# Capacidad KVM 2 para Development

Perfil de trabajo: 2 vCPU, 8 GB RAM y 100 GB de almacenamiento para Ubuntu, Docker, Dokploy, su Postgres/Redis/Traefik, Tailscale, SQL Server, API y dos webs. Debe medirse: el nombre comercial del plan no garantiza IOPS o rendimiento sostenido.

## Presupuesto inicial

| Componente | Memoria/CPU inicial |
| --- | --- |
| SQL Server container | hard limit 4 GB / 1.25 CPU |
| SQL `MSSQL_MEMORY_LIMIT_MB` | 3072 MB dentro del límite |
| Migrator/seeder/ops | 512 MB / 0.50 CPU, transitorio |
| Beszel hub/agent | 384 MB / 0.30 CPU persistente; init 32 MB / 0.05 CPU transitorio |
| API | 768 MB / 0.60 CPU |
| Public Web Next | 512 MB / 0.35 CPU |
| AVIAM Web Nginx | 128 MB / 0.15 CPU |
| SQL Tools Gateway | 64 MB / 0.10 CPU |

Esta tabla registra límites de Compose, no consumo medido ni memoria libre garantizada. SQL, observabilidad, API y ambas webs ya tienen runtimes Development aceptados. Los límites no son una autorización para saturarlos simultáneamente. No ejecutar builds en el VPS ni desplegar varias imágenes pesadas a la vez. Ajustar solo con métricas de working set, CPU, IOPS, latencia y errores.

El host auditado inicialmente no tenía swap. En el rollout se creó un swapfile de 2 GiB, modo `0600`, persistente y con `vm.swappiness=10`; es un amortiguador ante picos, no capacidad adicional para carga sostenida.

SQL usa `shm_size=512m`, 90 s de gracia y logs rotados. API/web usan logs de 10 MB con hasta 5 archivos por contenedor, según sus Compose actuales. Mantener 15 GB libres; las alertas externas de disco y sus umbrales siguen diferidos hasta su aprobación ([backlog](development-hardening-backlog.md)). Los assets actuales caben en sus imágenes; no son object storage.

## Almacenamiento

- `/var/opt/mssql` en named volume externo y persistente.
- backups en otro named volume; siete locales como retención inicial.
- jamás almacenar binarios/evidencias en SQL o una carpeta improvisada del checkout.
- limpiar imágenes no referenciadas mediante política controlada, nunca borrar volúmenes por rutina.
- probar semanalmente restore + `DBCC CHECKDB`.

Un backup en el mismo VPS no protege frente a pérdida total. Antes de aceptar datos no reconstruibles se necesita copia cifrada off-host.

## Red

SQL no publica 1433. API y webs ligan puertos solo a `127.0.0.1`; Tailscale Services entrega HTTPS al tailnet. El gateway SQL Tools separado liga únicamente `127.0.0.1:11433` y se presenta como Service TCP privado; no convierte SQL en puerto público. Verificar firewall desde fuera porque Docker puede modificar iptables. No anunciar redes Docker completas por Tailscale.

Ruta objetivo de la tablet; la integración real y el carril APK siguen diferidos:

```text
APK Development instalada -> Tailscale/HTTPS -> Elevant API en KVM -> SQL privado
```

No se sirve Mobile como web. Una app de Play Store Production necesitará endpoint público real y su propio perfil de firma/configuración.

## Límites de continuidad

Un KVM es un punto único de fallo. Development puede aceptar reconstrucción mientras todo sea sintético. Production requiere otra evaluación de capacidad/HA, licencia SQL, RPO/RTO, backup externo, restore probado, observabilidad y posible separación de la base.
