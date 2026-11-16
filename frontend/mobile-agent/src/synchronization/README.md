# Sincronización móvil

- `flight-report-outbox.ts`: la cola persistente de la tablet, por cuenta. Guarda primero cada comando con su clave de
  idempotencia estable y lo envía después en orden: hitos, datos del vuelo, firmas, marcas y fotos del walk-around,
  charter y, desde el hueco 3-I, el inicio, las transiciones de servicio, los cargos, el envío del checklist y el chat.
  El inicio y los servicios llevan la hora del toque; un comando que reservó una versión anterior se importa una vez
  con su misma clave y sin hora, así su cuerpo y el hash de su recibo siguen siendo los primeros.
- `ramp-command-projection.ts`: aplica lo que espera en la cola sobre la vista de ELEVANT (de la red o de la copia
  guardada), para que la pantalla muestre la operación como la dejó el agente, marcada «En el dispositivo».
- `server-clock.ts`: el desfase del reloj de la tablet frente a ELEVANT, tomado de la cabecera `Date` (hueco 3-N18).

El envío (`services/flight-report.ts`) es FIFO por operación: sin señal o con la sesión revocada se detiene todo; una
foto que ELEVANT no puede guardar ahora no detiene nada y el agente puede descartarla (`walkaround_photo_unavailable`),
y una que la tablet no puede leer (`walkaround_photo_unreadable`) o cuya marca ELEVANT rechazó (`damage_mark_refused`)
no se envía y queda bloqueada para descartarse (al reintentar la marca, su foto la sigue); cualquier otro fallo
temporal retiene solo el resto de su operación, y un inicio rechazado también. Un rechazo queda en «Sincronización»
hasta que el agente lo revise.
SignalR no confirma la persistencia de un comando: solo la respuesta de ELEVANT lo hace.
