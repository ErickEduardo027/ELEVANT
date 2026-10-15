# Composición móvil

Expo Router compone el acceso, la cola canónica de operaciones, el manifiesto
operativo, el checklist, las incidencias, el chat por operación y las
notificaciones. `/sync` enumera los comandos reservados de la cuenta,
reintenta incidencias y mensajes y conserva visibles los casos que requieren
conciliación desde su operación.

Las rutas solo llaman servicios de aplicación. No colocan tokens, reglas de
autorización, persistencia o acceso directo a proveedores en componentes.
