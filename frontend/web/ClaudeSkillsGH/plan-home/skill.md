CONTEXTO DE CONTINUIDAD — LEE ANTES DE EMPEZAR:

Este trabajo se está desarrollando en una rama independiente para el entorno de Gestión Humana.

La rama actual NO contiene el trabajo completo realizado anteriormente para Administrador/OCC.

Existe una rama de referencia llamada:

feat/adminocc

IMPORTANTE:
Antes de implementar este módulo, debes inspeccionar la rama `feat/adminocc` para estudiar cómo fue construido el entorno Administrador/OCC y utilizarlo como REFERENCIA de arquitectura, UX/UI y componentes.

NO debes hacer checkout de `feat/adminocc`.
NO debes modificar `feat/adminocc`.
NO debes sobrescribir la rama actual.
NO debes copiar archivos indiscriminadamente.

La rama `feat/adminocc` debe utilizarse únicamente para analizar y reproducir patrones ya establecidos.

==================================================
OBJETIVO
==================================================

Construir el layout "Home" del entorno Gestión Humana de ELEVANT.

Este entorno pertenece a la misma aplicación que Administrador/OCC, pero es un entorno independiente para otro rol.

Los usuarios de:

- Administrador/OCC
- Gestión Humana
- Contratos
- Finanzas

comparten el mismo login general.

Después de autenticarse, el usuario debe acceder al entorno correspondiente según su rol.

En esta rama estamos construyendo exclusivamente el entorno de:

GESTIÓN HUMANA

Esta tarea corresponde únicamente a:

- Home
- AppShell
- Sidebar
- navegación
- integración con routing
- estructura base del área de contenido

NO construir todavía los módulos funcionales.

==================================================
PRIMER PASO OBLIGATORIO — INSPECCIONAR feat/adminocc
==================================================

Antes de escribir código, inspecciona la rama:

feat/adminocc

Analiza específicamente:

1. Estructura general del frontend.
2. AppShell.
3. Sidebar.
4. SidebarItem.
5. Topbar.
6. Sistema de routing.
7. Manejo del estado activo.
8. Manejo del modo claro/oscuro.
9. Tokens de diseño.
10. Tipografía.
11. Espaciados.
12. Bordes y radios.
13. Glassmorphism.
14. Animaciones y transiciones.
15. Responsive behavior.
16. Sistema de badges.
17. Sistema de usuario/avatar.
18. Organización de componentes.
19. Convenciones de nombres.
20. Cómo está separada la navegación de los módulos.

Determina cuáles componentes son suficientemente genéricos para ser reutilizados.

Si en `feat/adminocc` existe un AppShell/Sidebar reutilizable, replica esa arquitectura en esta rama.

Si es necesario adaptar los componentes para que acepten diferentes configuraciones de navegación por rol, hazlo de manera limpia y reutilizable.

NO copies componentes funcionales de los módulos de Admin/OCC que no sean necesarios para el shell.

==================================================
REGLA FUNDAMENTAL DE ARQUITECTURA
==================================================

El objetivo NO es crear:

AdminAppShell
HumanResourcesAppShell

como dos implementaciones duplicadas.

Siempre que sea posible, crear una arquitectura compartida:

AppShell
├── Sidebar
├── SidebarItem
├── Topbar
└── Content

y proporcionar la navegación correspondiente según el rol.

Conceptualmente:

Admin/OCC
→ navigation configuration propia

Gestión Humana
→ navigation configuration propia

El shell visual debe mantenerse consistente.

Si la arquitectura existente de `feat/adminocc` no permite esto todavía, refactoriza únicamente lo necesario para permitir múltiples configuraciones de navegación sin romper el comportamiento existente de referencia.

==================================================
IDENTIDAD VISUAL
==================================================

Gestión Humana debe sentirse como parte de ELEVANT.

NO crear una identidad visual diferente.

Reutilizar exactamente los tokens establecidos en Admin/OCC.

Paleta:

Azul marino primario:
#0B1F3F

Azul de acento:
#145DC4

Naranja:
#F2661E

Modo claro:

Background:
#F7F9FB

Cards:
#FFFFFF

Texto principal:
#0B1F3F

Texto secundario:
#6B7684

Modo oscuro:

Background:
#0A1220

Cards:
rgba(11,31,63,0.55)

Texto principal:
#F4F6F9

Texto secundario:
#94A3B8

Estados:

Info:
#145DC4

Activo / Atención:
#F2661E

Positivo:
#1E9E6B

Advertencia:
#D9A441

Crítico:
#C4453C

Mantener:

- misma tipografía
- mismos tamaños
- mismos radios
- mismas sombras
- mismos bordes
- mismo glassmorphism
- mismas transiciones
- misma jerarquía visual

==================================================
SIDEBAR — GESTIÓN HUMANA
==================================================

Crear la navegación específica de Gestión Humana.

ORDEN EXACTO:

1. Dashboard
2. Gestión de usuarios y cuentas
3. Habilitaciones y certificaciones
4. Carnets y permisos aeroportuarios
5. Horarios y disponibilidad
6. Reportes
7. Trazabilidad / Auditoría
8. Notificaciones

No agregar otros módulos.

==================================================
NAVEGACIÓN
==================================================

1. DASHBOARD

Label:

Dashboard

Ruta:

Utilizar la convención de routing existente.

Si el proyecto ya utiliza una estructura como:

/human-resources/dashboard

puede utilizarse.

No inventar una arquitectura diferente si ya existe una convención clara.

Esta será la pantalla principal del entorno.

Por ahora solamente crear un placeholder simple.

--------------------------------------------------

2. GESTIÓN DE USUARIOS Y CUENTAS

Label:

Gestión de usuarios y cuentas

Ruta sugerida:

/human-resources/users

Funcionalidad futura:

- crear usuarios
- editar usuarios
- activar/desactivar cuentas
- asignar roles
- administrar permisos
- consultar cuentas

NO implementar estas funcionalidades todavía.

Solo crear la navegación y placeholder.

--------------------------------------------------

3. HABILITACIONES Y CERTIFICACIONES

Label:

Habilitaciones y certificaciones

Ruta sugerida:

/human-resources/certifications

Debe soportar posteriormente:

- habilitaciones
- certificaciones
- equipos autorizados
- vigentes
- próximas a vencer
- vencidas
- historial de entrenamientos

Este item debe tener un badge preparado para mostrar:

- próximas a vencer
- vencidas

IMPORTANTE:

El badge debe poder distinguir visualmente:

Advertencia:
#D9A441

Crítico:
#C4453C

Si actualmente no existe backend/datos reales, utilizar mocks.

No implementar lógica real todavía.

--------------------------------------------------

4. CARNETS Y PERMISOS AEROPORTUARIOS

Label:

Carnets y permisos aeroportuarios

Ruta sugerida:

/human-resources/permits

Funcionalidad futura:

- carnet aeroportuario
- licencia de conducir en rampa
- fechas de emisión
- fechas de vencimiento
- próximos vencimientos
- documentos vencidos
- alertas

Debe tener badge preparado para mostrar vencimientos.

--------------------------------------------------

5. HORARIOS Y DISPONIBILIDAD

Label:

Horarios y disponibilidad

Ruta sugerida:

/human-resources/schedules

Funcionalidad futura:

- turnos
- disponibilidad
- asignación por terminal
- cobertura
- personal disponible

--------------------------------------------------

6. REPORTES

Label:

Reportes

Ruta sugerida:

/human-resources/reports

Funcionalidad futura:

- vencimientos
- altas/bajas
- personal por terminal
- personal por turno
- cobertura de habilitaciones

--------------------------------------------------

7. TRAZABILIDAD / AUDITORÍA

Label:

Trazabilidad / Auditoría

Ruta sugerida:

/human-resources/audit

Funcionalidad futura:

- acciones críticas
- activación de cuentas
- desactivación de cuentas
- cambios de roles
- modificaciones
- usuario responsable
- fecha/hora

--------------------------------------------------

8. NOTIFICACIONES

Label:

Notificaciones

Ruta sugerida:

/human-resources/notifications

Debe incluir un badge de notificaciones no leídas.

El patrón visual debe quedar preparado para reutilizar posteriormente el módulo de Notificaciones desarrollado para Admin/OCC.

NO copiar todo el módulo funcional todavía.

==================================================
SIDEBAR
==================================================

Reutilizar el patrón visual de `feat/adminocc`.

Desktop:

~260px

Colapsado:

~72px

Expandido:

- logo ELEVANT completo
- iconos outline
- labels visibles

Colapsado:

- isotipo/logo compacto
- iconos
- tooltip al hacer hover

Item activo:

- fondo glass sutil
- barra lateral naranja
- texto/acento
- transición suave

Hover:

- fondo sutil
- ligero desplazamiento del icono
- transición rápida

==================================================
BADGES
==================================================

Los badges deben ser reutilizables y preparados para datos dinámicos.

Habilitaciones:

- warning cuando existen próximas a vencer
- critical cuando existen vencidas

Carnets:

- warning cuando existen próximos a vencer
- critical cuando existen vencidos

Notificaciones:

- badge de no leídas

El badge debe desaparecer cuando el valor sea 0.

No utilizar badges permanentemente visibles con "0".

==================================================
TOPBAR
==================================================

Reutilizar el patrón existente de `feat/adminocc`.

NO crear un Topbar completamente nuevo.

Mantener:

- usuario
- avatar
- menú
- modo claro/oscuro
- notificaciones
- reloj si forma parte del Topbar existente

Adaptar solamente aquello que dependa del entorno.

El usuario debe identificarse como:

"Gestión Humana"

o utilizar el sistema dinámico de usuario/rol existente si ya está preparado.

==================================================
MODO CLARO / OSCURO
==================================================

Debe funcionar exactamente igual que en Admin/OCC.

No crear un segundo sistema de temas.

Reutilizar el mecanismo existente si se encuentra en la rama de referencia.

Verificar:

- Sidebar
- Topbar
- contenido
- badges
- estados activos
- hover
- overlays

en ambos modos.

==================================================
RESPONSIVE
==================================================

Desktop:

Sidebar expandido.

Tablet <=1024px:

Sidebar colapsado.

Mobile:

Sidebar como drawer lateral.

Reutilizar exactamente el comportamiento de Admin/OCC siempre que sea posible.

No crear un sistema responsive paralelo.

==================================================
ÁREA DE CONTENIDO
==================================================

Crear un placeholder sencillo para Dashboard de Gestión Humana.

Ejemplo:

Título:

"Dashboard"

Descripción:

"Resumen general de la operación de Gestión Humana."

No construir todavía:

- KPIs
- gráficos
- tablas
- métricas
- alertas
- reportes

Eso se hará en el siguiente módulo.

El objetivo es verificar que:

Sidebar → ruta → contenido

funcione correctamente.

==================================================
ROUTING
==================================================

Crear las rutas necesarias para:

/human-resources/dashboard
/human-resources/users
/human-resources/certifications
/human-resources/permits
/human-resources/schedules
/human-resources/reports
/human-resources/audit
/human-resources/notifications

ADAPTAR estas rutas a la convención real del proyecto si existe otra estructura.

No romper ninguna ruta existente.

==================================================
ROL
==================================================

Si existe un sistema de roles en el frontend, incorporar:

GESTIÓN HUMANA

como rol/entorno.

El comportamiento esperado:

Login general
↓
Usuario autenticado
↓
Rol Gestión Humana
↓
Home de Gestión Humana

No implementar autenticación real.

No modificar backend.

No crear autorización backend.

==================================================
DATOS MOCK
==================================================

Como todavía no existen endpoints reales para estos módulos:

utilizar datos mock mínimos solamente para:

- badges
- nombre/rol del usuario si es necesario
- navegación

No crear datos ficticios complejos de empleados, habilitaciones o documentos.

==================================================
RESTRICCIONES
==================================================

- CERO emojis.
- CERO iconografía consumer.
- No crear un diseño diferente al de ELEVANT.
- No modificar la rama `feat/adminocc`.
- No hacer checkout de `feat/adminocc`.
- No copiar archivos innecesarios.
- No reconstruir componentes si pueden reutilizarse.
- No implementar backend.
- No crear endpoints.
- No crear base de datos.
- No agregar librerías innecesarias.
- No romper Admin/OCC.
- No construir todavía los módulos funcionales.

==================================================
CRITERIOS DE ACEPTACIÓN
==================================================

La tarea está terminada cuando:

1. La rama actual tiene un Home funcional para Gestión Humana.
2. Existe Sidebar específico para Gestión Humana.
3. Existe Topbar reutilizado/adaptado desde el patrón de referencia.
4. Las 8 rutas funcionan.
5. Dashboard tiene placeholder.
6. Los badges están preparados.
7. Sidebar expandido funciona.
8. Sidebar colapsado funciona.
9. Responsive funciona.
10. Claro/oscuro funciona.
11. El patrón visual coincide con Admin/OCC.
12. No se modificó `feat/adminocc`.
13. No se rompieron funcionalidades existentes de esta rama.
14. TypeScript no presenta errores.
15. Lint no presenta errores.
16. Build finaliza correctamente.

==================================================
VERIFICACIÓN FINAL
==================================================

Al terminar:

1. Ejecuta el typecheck disponible.
2. Ejecuta lint.
3. Ejecuta build.

Utiliza los scripts reales definidos en package.json.

Después informa:

- archivos creados
- archivos modificados
- componentes reutilizados
- componentes nuevos
- rutas creadas
- cómo se implementó la separación del entorno Gestión Humana
- resultado de typecheck
- resultado de lint
- resultado de build
- cualquier decisión arquitectónica relevante

NO avances al Dashboard todavía.

Esta tarea termina exclusivamente con el Home/Sidebar de Gestión Humana.