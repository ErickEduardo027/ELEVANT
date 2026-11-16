# Composición móvil

Expo Router compone el acceso, la cola canónica de operaciones, el manifiesto
operativo, el checklist, las incidencias, el chat por operación y las
notificaciones. Solo `/sync` muestra una función pendiente: no ejecuta el
prototipo ni escribe estado local.

Las rutas solo llaman servicios de aplicación. No colocan tokens, reglas de
autorización, persistencia o acceso directo a proveedores en componentes.
