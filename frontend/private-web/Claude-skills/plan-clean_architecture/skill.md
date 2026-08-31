EJECUTA ESTA TAREA DE FORMA RIGUROSA, PERO OPTIMIZANDO TOKENS Y TIEMPO: inspecciona primero, modifica solo lo necesario, reutiliza código existente y no reconstruyas funcionalidades que ya funcionan.

OBJETIVO

Dejar la rama `Lw-Front` completamente ordenada y funcional para posteriormente hacer un merge limpio hacia `develop`.

El objetivo principal es resolver la arquitectura actual de entrada de los portales web y establecer UN ÚNICO LOGIN para los 4 roles web back-office:

1. Administrador/OCC
2. Gestión Humana
3. Contratos
4. Finanzas

IMPORTANTE: existen otros dos sistemas independientes que NO forman parte de esta integración:

- Agente de Rampa: aplicación móvil en otro directorio, con login y portal propios. NO modificar.
- Cliente/Aerolínea: portal web independiente en otro directorio, con login propio. NO modificar.

CONTEXTO ACTUAL

- `Lw-Front` parte de los últimos cambios de `develop`.
- Administrador/OCC ya tiene su entorno completo.
- Gestión Humana ya tiene su entorno completo.
- Contratos y Finanzas ya existen en `develop`.
- Históricamente Admin/OCC tenía su propio `dashboard.html`.
- Al integrar Admin/OCC con Gestión Humana surgió el problema de múltiples puntos de entrada/`index.html`.
- Necesitamos resolverlo correctamente sin perder ninguna funcionalidad existente.
- Todos los portales web back-office deben poder iniciarse desde un único login.
- Después del login, las credenciales mock deben determinar el rol y llevar al usuario a su respectivo entorno.

ANTES DE MODIFICAR

Inspecciona brevemente:

1. `git status`
2. ramas relevantes y estado de `Lw-Front`
3. estructura de carpetas
4. `index.html`, `dashboard.html` y demás entry points
5. `main.*`
6. configuración de Vite/React/build
7. router actual, si existe
8. login existente
9. AppShell/Layout de Admin/OCC
10. AppShell/Layout de Gestión Humana
11. estructura de Contratos
12. estructura de Finanzas

Determina cómo están funcionando realmente los distintos entry points antes de mover, eliminar o reemplazar cualquiera.

NO asumas que todos los `index.html` pueden eliminarse.

ARQUITECTURA OBJETIVO

El resultado debe tener conceptualmente:

    /login
       ↓
    autenticación mock
       ↓
    identificación del rol
       ↓
    Home/entorno correspondiente

Rutas conceptuales:

    /login
    /admin-occ/...
    /gestion-humana/...
    /contratos/...
    /finanzas/...

Usa las rutas reales existentes si ya están implementadas. No inventes rutas paralelas innecesarias.

La solución debe tener:

- un único punto de inicio para los 4 roles;
- autenticación mock centralizada;
- routing por rol;
- protección básica de rutas;
- layouts independientes por entorno;
- reutilización de componentes compartidos solo cuando corresponda;
- separación clara entre los módulos de cada rol.

NO mezcles visualmente ni funcionalmente Admin/OCC con Gestión Humana. Comparten infraestructura de entrada, pero cada entorno conserva su propio shell, sidebar, módulos y navegación.

AUTENTICACIÓN MOCK

Crear o reutilizar un único servicio/fuente de datos para usuarios mock.

Credenciales de desarrollo:

admin@elevant.test          → Administrador/OCC
gestionhumana@elevant.test  → Gestión Humana
contratos@elevant.test      → Contratos
finanzas@elevant.test       → Finanzas

La contraseña puede ser común para desarrollo si eso simplifica la implementación.

NO repartir credenciales hardcodeadas por componentes.

La arquitectura debe separar:

Login UI
→ Auth Service
→ Mock Auth
→ Usuario autenticado + rol
→ Router

Debe quedar preparada para reemplazar posteriormente:

mockLogin()

por una llamada API REST real sin tener que reconstruir el Login ni los portales.

SESIÓN

Implementa o reutiliza el mecanismo existente para:

- guardar sesión;
- detectar usuario autenticado;
- proteger rutas;
- impedir acceso sin sesión;
- impedir acceso a otro entorno;
- logout;
- regresar a `/login` después del logout.

No implementes backend real.

CONTROL DE ACCESO

Ejemplo:

Usuario Gestión Humana:
- puede acceder a `/gestion-humana/*`;
- no debe acceder a `/admin-occ/*`, `/contratos/*` ni `/finanzas/*`.

Si intenta acceder a un entorno no autorizado:
→ redirigir a su Home correspondiente.

Si no existe sesión:
→ `/login`.

CONSERVACIÓN DE FUNCIONALIDADES

ESTO ES CRÍTICO.

NO eliminar ni reconstruir:

- ningún módulo de Administrador/OCC;
- ningún módulo de Gestión Humana;
- ningún módulo de Contratos;
- ningún módulo de Finanzas;
- componentes existentes;
- estilos;
- layouts;
- rutas funcionales;
- lógica existente.

Todo lo construido anteriormente debe permanecer disponible.

No reemplaces una implementación funcional por una versión simplificada solo para resolver el login.

Si existen componentes duplicados, reutiliza/generaliza únicamente cuando sea seguro y realmente reduzca duplicación.

ENTRY POINTS

El objetivo es conseguir un único punto de partida mediante el login, pero NO significa eliminar `index.html` indiscriminadamente.

Inspecciona primero cómo funcionan los entry points.

Si es posible y seguro, unifica la entrada de los 4 portales web mediante el mecanismo de routing existente.

Si algún entry point es técnicamente necesario para conservar un portal, mantenlo y adapta la arquitectura sin romperlo.

La prioridad es:

1. funcionalidad;
2. estabilidad;
3. arquitectura clara;
4. reducción de duplicación.

NO sacrifiques funcionalidad para conseguir una estructura "más bonita".

OTROS SISTEMAS — NO TOCAR

NO modificar:

- aplicación móvil del Agente de Rampa;
- login del Agente;
- portal del Agente;
- portal Cliente/Aerolínea;
- login Cliente/Aerolínea;
- directorios independientes correspondientes a esos sistemas.

GIT

Trabaja EXCLUSIVAMENTE sobre:

`Lw-Front`

NO hagas:

- merge hacia `develop`;
- push;
- reset;
- rebase destructivo;
- eliminación de ramas;
- borrado masivo de archivos.

El objetivo es dejar `Lw-Front` lista para posteriormente hacer:

`develop ← Lw-Front`

VALIDACIÓN

Después de implementar ejecuta las herramientas disponibles del proyecto:

- lint
- typecheck, si existe
- tests, si existen
- build

Prueba como mínimo:

1. `admin@elevant.test` → Administrador/OCC.
2. `gestionhumana@elevant.test` → Gestión Humana.
3. `contratos@elevant.test` → Contratos.
4. `finanzas@elevant.test` → Finanzas.
5. Logout → `/login`.
6. Sin sesión → rutas protegidas redirigen al login.
7. Gestión Humana intentando entrar a Admin/OCC → bloqueo/redirección.
8. Admin/OCC intentando entrar a Gestión Humana → bloqueo/redirección.
9. Contratos y Finanzas conservan sus portales.
10. Build completo sin errores.
11. Verificar que Agente de Rampa y Cliente/Aerolínea no fueron modificados.

IMPORTANTE SOBRE TOKENS

No expliques cada paso innecesariamente.
No analices archivos irrelevantes.
No reconstruyas componentes existentes.
No generes documentación extensa.

Trabaja en ciclos cortos:

INSPECCIONAR → CAMBIO MÍNIMO → VALIDAR

Si encuentras un conflicto arquitectónico importante, investiga únicamente los archivos relacionados antes de decidir.

CRITERIO DE ÉXITO

La tarea solo está terminada si:

- los 4 roles web parten del mismo login;
- las credenciales mock funcionan;
- cada rol llega a su propio entorno;
- las rutas están protegidas;
- Admin/OCC conserva todo lo existente;
- Gestión Humana conserva todo lo existente;
- Contratos conserva todo lo existente;
- Finanzas conserva todo lo existente;
- Agente de Rampa permanece intacto;
- Cliente/Aerolínea permanece intacto;
- no existen regresiones evidentes;
- `Lw-Front` compila correctamente;
- no se hizo merge a `develop`.

AL FINAL, entrega SOLO un resumen breve con:

- solución aplicada;
- archivos principales modificados;
- credenciales mock;
- resultado de lint/typecheck/tests/build;
- cualquier conflicto pendiente.

Si para resolver el problema necesitas eliminar o mover un entry point y existe riesgo de perder funcionalidad, NO lo hagas automáticamente. Detente y explica el conflicto antes de realizar una operación destructiva.