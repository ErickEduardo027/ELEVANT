# Skill — Notificaciones Gestión Humana

CONTEXTO:
Cierra el entorno de Gestión Humana implementando su módulo Notificaciones.

ANTES DE MODIFICAR:
- Inspecciona el proyecto actual.
- Revisa el módulo Notificaciones de Admin/OCC y reutiliza EXACTAMENTE:
  NotificationFeed
  NotificationCard
  NotificationFilterBar
  NotificationSettingsDrawer
- Revisa también el Sidebar GH para mantener su badge de no leídas.
- NO dupliques componentes ni sistemas existentes.
- No hagas refactors fuera del alcance.

OBJETIVO:
Crear la ruta de Notificaciones dentro del shell de Gestión Humana, usando el mismo sistema visual y funcional de Admin/OCC, pero con categorías propias de GH.

CATEGORÍAS:
- Vencimientos: carnet, licencia, habilitaciones
- Cuentas: cuentas pendientes de activar/desactivadas
- Cobertura: huecos de cobertura en turnos
- Confirmaciones: renovaciones, cambios de rol, exportaciones
- Generales: avisos del sistema

FUNCIONALIDAD:
- Feed agrupado por fecha.
- Filtros: Todas, Vencimientos, Cuentas, Cobertura, Confirmaciones, Generales.
- Filtro por severidad.
- Toggle "Solo no leídas".
- Búsqueda.
- "Marcar todas como leídas".
- Marcar individual como leída.
- Acciones contextuales hacia los módulos GH correspondientes.
- Badge de no leídas sincronizado con el Sidebar GH.
- Reutilizar NotificationSettingsDrawer para preferencias y umbral de vencimiento configurable: 15/30/45 días.
- Mantener preparado el diseño para futuras notificaciones en tiempo real.

SEVERIDAD:
Usar exactamente el esquema existente:
info azul, warning ámbar, crítica roja, positiva verde.

ESTADOS:
- loading/skeleton
- feed normal
- solo no leídas
- notificación crítica
- todo leído
- vacío general/categoría
- configuración abierta

DATOS:
- Mocks realistas temporalmente.
- Separar datos/servicio de la UI para futura API REST.
- No inventar endpoints.
- Dejar estructura compatible con polling/WebSocket futuro.

REGLAS:
- React + Tailwind.
- Reutilizar componentes existentes.
- Mantener exactamente tokens, responsive, dark/light y patrones de Admin/OCC.
- Cero emojis.
- Cero dependencias nuevas salvo necesidad real.
- No modificar módulos existentes.
- No recrear componentes ya disponibles.
- Priorizar funcionalidad sobre mejoras opcionales.

AL FINAL:
Verifica rutas, imports, TypeScript y build/lint disponible.
Corrige únicamente errores relacionados con este módulo.
Confirma que Admin/OCC y Gestión Humana continúan funcionando sin romperse.