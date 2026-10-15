# Sincronización móvil

`mobile-sync-center.ts` enumera los comandos namespaced de la sesión actual.
La pantalla `/sync` muestra pendientes, bloqueados y casos que requieren volver
a su operación. Incidencias y mensajes se reintentan con la clave de idempotencia
original; los otros comandos permanecen congelados hasta conciliarlos con su
lectura canónica. `use-connectivity.ts` alimenta el indicador permanente de red.
SignalR no confirma la persistencia de un comando.

# Sincronización móvil

La aplicación conserva comandos operativos por cuenta y operación antes de
intentar enviarlos. El coordinador automático se activa al abrir la aplicación,
al volver al primer plano y cuando el dispositivo recupera conectividad.

La cola reutiliza la clave de idempotencia ya reservada para checklist,
transiciones de servicios, cargos, incidencias, asistencia, chat, cierre y
correcciones. Los rechazos deterministas permanecen visibles o se resuelven con
la política específica del servicio; los errores de red nunca descartan el
comando. El agente puede inspeccionar y reintentar todo desde `/sync`.

Cerrar sesión con elementos pendientes exige confirmación explícita porque el
aislamiento por cuenta obliga a eliminar esa cola al terminar la sesión.
