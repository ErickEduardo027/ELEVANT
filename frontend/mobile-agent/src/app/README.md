# Composición móvil

Expo Router compone el acceso, la cola canónica de operaciones y el manifiesto
de solo lectura. Las rutas históricas de checklist, incidencias, chat y
sincronización muestran una función pendiente: no ejecutan el prototipo ni
escriben estado local.

Las rutas solo llaman servicios de aplicación. No colocan tokens, reglas de
autorización, persistencia o acceso directo a proveedores en componentes.
