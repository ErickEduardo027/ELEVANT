# Clausura comercial de servicios solicitada por OCC

> Implementar este plan en el worktree `feat/occ-service-closure`, con pruebas que fallen antes de cada cambio de comportamiento.

**Meta:** OCC solicita clausuras motivadas; Contratos decide y puede republicar con motivo. Solo la oferta para nuevas solicitudes públicas cambia.

**Arquitectura:** La API compartida conserva un expediente comercial auditable. La aprobación cambia `ServiceDefinition.IsPublic` en la misma transacción. El outbox interno y el hub del catálogo invalidan lecturas HTTP; ninguna pantalla trata el socket como fuente de verdad.

**Tecnología:** .NET 10, EF Core/SQL Server, OpenAPI, React/Vite, Next.js y SignalR.

**Especificación:** Plan aprobado en la conversación del 2026-10-05.

## Reglas globales

- Clausura global; `IsActive` y contratos/operaciones previos permanecen intactos.
- Motivo de solicitud, denegación y republicación: 10–1 000 caracteres tras recortar espacios.
- Una solicitud pendiente por servicio; reintento del mismo UUID y cuerpo devuelve el expediente.
- Todo OCC autorizado ve el historial; Contratos conserva decisiones y republicación. Roles personalizados siguen permisos explícitos.
- Prohibir que el solicitante decida su propia petición. No enviar correo.
- Preservar cambios ajenos del checkout principal y no tocar Production.

## Tareas

### 1. Dominio y persistencia

- [x] Escribir pruebas para motivo inválido, pendiente duplicado, reintento idéntico, decisión concurrente, denegación, aprobación y republicación.
- [x] Añadir agregado `commercial.service_closure_requests`, mapeo EF con FK `NO ACTION`, UUID único, `rowversion`, índice único filtrado de pendiente y migración aditiva generada por el script del repositorio.
- [x] Añadir puerto y store que exijan membresía interna AVIAM, permisos vivos y transacciones atómicas. Aprobar pone solo `IsPublic=false`; republicar pone `IsPublic=true` solo con razón y servicio activo.
- [x] Mantener snapshots históricos y auditar cada transición. Ejecutar pruebas enfocadas y revisar SQL de migración.

### 2. API, permisos y avisos

- [x] Escribir pruebas HTTP de permisos, entradas, concurrencia, idempotencia y visibilidad; pruebas del outbox y del hub tras commit.
- [x] Exponer lectura paginada y comandos de solicitud/decisión, más comando de republicación del catálogo. Dar `400/403/404/409` consistentes y versiones esperadas.
- [x] Sembrar permisos separados de leer, solicitar, decidir y republicar; asignar OCC y Contratos explícitamente, con soporte de roles personalizados.
- [x] Extender el feed autorizado y destinatarios del outbox. Impedir que un PUT normal republique una clausura aprobada sin motivo; invalidar el hub público solo después del commit.
- [x] Regenerar OpenAPI y cliente compartido; ejecutar pruebas/backend y comprobación de modelo.

### 3. AVIAM Web

- [x] Escribir pruebas de pestaña OCC, motivo obligatorio, historial compartido, bandeja/decisión de Contratos, republicación y permisos personalizados.
- [x] Añadir `Notificaciones → Servicios` a la ruta canónica OCC con catálogo público en carrusel y expediente textual separado; usar modal ELEVANT.
- [x] Añadir bandeja `Clausuras` en `Contratos → Servicios`, decisiones y republicación motivada; mantener el CRUD existente.
- [x] Mostrar capacidades en workspace personalizado y editor de roles. Revalidar por feed, foco, reconexión y sondeo de respaldo.
- [x] Ejecutar pruebas y build de private-web.

### 4. Public Web y cierre

- [x] Escribir prueba: si cambia el catálogo tras seleccionar, mostrar qué servicio salió, volver al paso 1 y pedir nueva confirmación sin borrar datos de aerolínea/representante.
- [x] Mantener el UUID y cuerpo del envío cuando la respuesta sea incierta; consultar el comprobante en modo de solo lectura antes de permitir otro envío. Conservar la validación del servidor de `IsActive && IsPublic`.
- [x] Ejecutar pruebas, typecheck y lint públicos; comprobar flujos HTTP y SQL integrados de aprobación/denegación/republicación.
- [x] Actualizar flujo comercial, documentación de migración y Vault; regenerar y validar Vault. Revisar diff/secrets y preparar PR sin merge ni despliegue automático desde este paso.

## Revisión final

- Permisos retirados durante una sesión producen 403 aunque el botón siga visible.
- Edición concurrente del catálogo no sobrescribe una aprobación o republicación.
- Una solicitud histórica y su reintento idempotente conservan referencia tras la clausura; una solicitud nueva recibe conflicto.
- La consulta de comprobante no crea solicitudes: si el primer POST no persistió y el servicio se republica, el formulario exige una nueva confirmación.
- Pérdida de SignalR se recupera por HTTP y sondeo sin crear decisiones duplicadas.
