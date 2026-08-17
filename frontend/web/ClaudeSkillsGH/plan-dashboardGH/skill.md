CONTEXTO DE CONTINUIDAD — LEE ANTES DE EMPEZAR:

Estamos trabajando en una rama independiente para el entorno de Gestión Humana.

IMPORTANTE:
La rama actual contiene el Home/Sidebar de Gestión Humana con un placeholder para este Dashboard, pero NO contiene necesariamente todo lo desarrollado en Admin/OCC.

Existe una rama llamada `feat/adminocc` que contiene el entorno completo del Administrador/OCC.

ANTES DE GENERAR CÓDIGO, INSPECCIONA AMBAS REFERENCIAS:

1. Revisa la rama actual de Gestión Humana:
   - estructura del proyecto
   - AppShell
   - Sidebar
   - Topbar
   - rutas
   - placeholder actual del Dashboard
   - tokens y estilos disponibles

2. Revisa `feat/adminocc` como REFERENCIA:
   - Dashboard del Administrador/OCC
   - KpiCard
   - StatusBadge
   - gráficos
   - patrones de cards
   - feed de alertas/actividad
   - skeleton loaders
   - modo claro/oscuro
   - responsive
   - estructura de datos mock
   - convenciones de componentes y rutas

3. Identifica qué componentes de Admin/OCC pueden reutilizarse directamente o generalizarse.

4. NO copies módulos completos innecesariamente.

5. NO modifiques la funcionalidad de Admin/OCC.

6. Trabaja exclusivamente sobre la rama actual de Gestión Humana.

7. Si un componente de `feat/adminocc` es suficientemente genérico, reutilízalo o generalízalo correctamente para evitar duplicación.

8. No reconstruyas el AppShell, Sidebar ni Topbar de Gestión Humana. El Dashboard debe integrarse dentro del shell ya existente.

Antes de implementar, explica brevemente qué componentes existentes encontraste y cuáles vas a reutilizar.

---

ACTÚA COMO:

Senior Frontend Engineer + Product Designer especializado en aplicaciones enterprise.

Vas a diseñar y construir el Dashboard del entorno de Gestión Humana de "ELEVANT", plataforma de gestión de operaciones de ground handling para AVIAM Ltd. en el aeropuerto de Punta Cana (PUJ).

El Dashboard será la pantalla principal a la que llega un usuario con rol Gestión Humana después del login general de la plataforma.

NO crear una pantalla de login.

---

OBJETIVO FUNCIONAL:

El Dashboard debe proporcionar a Gestión Humana una vista panorámica del estado actual del personal y permitir detectar rápidamente situaciones que requieren atención.

Debe centralizar visualmente:

- Personal activo.
- Cuentas pendientes de activar.
- Habilitaciones próximas a vencer.
- Habilitaciones vencidas.
- Carnets aeroportuarios próximos a vencer.
- Carnets vencidos.
- Distribución del personal por terminal.
- Distribución por turno.
- Actividad reciente.
- Accesos rápidos a las tareas principales.

El objetivo principal de la pantalla es responder:

"¿Cómo está el personal actualmente y qué necesita atención?"

Este dashboard digitaliza el seguimiento que actualmente se realiza manualmente mediante una bitácora de Excel con formato condicional:

- Verde = vigente/normal.
- Amarillo = próximo a vencer.
- Rojo = vencido/crítico.

La interfaz debe convertir esta lógica manual en una experiencia digital clara, priorizada y accionable.

---

SKILL:

Antes de generar código, utiliza el skill de `frontend-design` disponible en el proyecto.

Mantén absoluta coherencia con el sistema visual existente de ELEVANT y especialmente con el Dashboard de Admin/OCC encontrado en `feat/adminocc`.

No inventes un nuevo lenguaje visual.

---

ESTILO GENERAL:

Premium, corporativo, minimalista, enterprise y aeroportuario.

Glassmorphism moderado.

Cero emojis.

Iconografía de línea fina.

Tipografía sans-serif consistente con el proyecto.

Mantener los mismos radios, sombras, espaciados, transiciones y jerarquía visual utilizados en Admin/OCC cuando sean reutilizables.

---

PALETA:

Azul marino primario:
#0B1F3F

Azul de acento:
#145DC4

Naranja:
#F2661E

MODO CLARO:

Background:
#F7F9FB

Cards:
#FFFFFF

Texto principal:
#0B1F3F

Texto secundario:
#6B7684

MODO OSCURO:

Background:
#0A1220

Cards:
rgba(11,31,63,0.55)

Texto principal:
#F4F6F9

Texto secundario:
#94A3B8

ESTADOS:

Vigente / Normal:
#1E9E6B

Próximo a vencer:
#D9A441

Vencido / Crítico:
#C4453C

Informativo:
#145DC4

No utilizar colores fuera de estos tokens.

---

ESTRUCTURA DEL DASHBOARD:

### 1. HEADER DEL CONTENIDO

La Topbar global ya existe.

NO reconstruirla.

Dentro del área principal mostrar:

Título:
"Dashboard"

Subtítulo:
"Resumen del personal y gestión humana"

A la derecha, si el patrón existente lo permite:

- fecha actual
- última actualización
- botón de actualizar

Mantener exactamente el patrón visual del Dashboard de Admin/OCC.

---

### 2. KPI CARDS

Reutilizar `KpiCard` del Dashboard de Admin/OCC si es compatible.

Mostrar cuatro KPIs principales:

#### Personal activo

Cantidad total de personal activo.

Puede incluir un desglose sutil por terminal si existe espacio.

#### Cuentas pendientes de activar

Cantidad de cuentas registradas que todavía requieren activación.

Si el número es mayor a cero, mostrar indicador de atención.

Acción:

"Revisar cuentas"

#### Habilitaciones próximas a vencer

Cantidad de habilitaciones que vencen dentro de los próximos 30 días.

Mostrar contador en ámbar.

Acción:

"Ver habilitaciones"

#### Habilitaciones y carnets vencidos

Cantidad total de documentos/habilitaciones vencidos.

Debe utilizar estado crítico.

Si el valor es mayor que cero, esta KPI debe tener mayor peso visual que las demás, sin utilizar animaciones agresivas.

Acción:

"Revisar vencidos"

La animación de conteo ascendente debe reutilizar el comportamiento existente de Admin/OCC.

---

### 3. PANEL "VENCIMIENTOS PRÓXIMOS"

Crear una glass card:

"Vencimientos próximos"

Mostrar una lista priorizada de documentos y habilitaciones.

Tipos posibles:

- Carnet aeroportuario.
- Licencia de conducir en rampa.
- Habilitación de equipo.
- Certificación.

Cada elemento debe mostrar:

- nombre del agente
- tipo de documento/habilitación
- fecha de vencimiento
- días restantes
- estado
- acción contextual

Ejemplo:

"Juan Pérez"
"Carnet aeroportuario"
"Vence en 8 días"

o:

"María López"
"Belt Loader"
"Vencido"

Orden:

1. Vencidos.
2. Vencimientos más próximos.
3. Vencimientos posteriores.

Utilizar los mismos badges y estados visuales existentes.

Agregar:

"Ver todos"

que navegue al módulo correspondiente de Habilitaciones/Carnets.

---

### 4. DISTRIBUCIÓN DEL PERSONAL

Crear una sección:

"Distribución del personal"

Utilizar la misma librería de gráficos ya utilizada por Admin/OCC.

NO instalar una nueva librería si ya existe una disponible.

Mostrar visualmente:

#### Personal por terminal

- Terminal A
- Terminal B
- FBO / Aviación local
- Sin asignación

#### Personal por turno

- Mañana
- Tarde
- Noche

Puede resolverse mediante:

- gráfico de dona
- barras horizontales
- o combinación coherente con el Dashboard de Admin/OCC.

No sobrecargar la pantalla con demasiados gráficos.

Los gráficos deben utilizar únicamente la paleta ELEVANT.

Los tooltips deben mostrar valores exactos.

---

### 5. DISPONIBILIDAD DEL PERSONAL

Crear una card:

"Disponibilidad actual"

Mostrar:

- Disponible.
- En turno.
- Ausente.
- No disponible.
- Sin asignación.

Incluir una representación visual de cobertura.

Ejemplo:

"82% de cobertura actual"

Y un desglose:

"Terminal A — 91%"
"Terminal B — 78%"
"FBO — 84%"

Estos valores serán mocks inicialmente.

Preparar la estructura para posteriormente consumir API REST.

---

### 6. CUENTAS PENDIENTES DE ACTIVAR

Crear una sección:

"Cuentas pendientes de activar"

Mostrar una lista corta con:

- nombre
- rol
- fecha de registro
- estado
- acción

Ejemplo:

"Juan Pérez"
"Agente de rampa"
"Registrado hace 2 días"

Acción:

"Gestionar cuentas"

Debe navegar al módulo:

"Gestión de usuarios y cuentas"

Si no existen cuentas pendientes, mostrar:

"No hay cuentas pendientes de activación"

con un estado vacío limpio y sobrio.

---

### 7. ACTIVIDAD RECIENTE

Crear una sección:

"Actividad reciente"

Debe reutilizar el patrón visual del feed de alertas/actividad encontrado en `feat/adminocc`.

Mostrar máximo 5-6 eventos.

Ejemplos:

- Cuenta de agente activada.
- Nueva habilitación registrada.
- Carnet actualizado.
- Agente deshabilitado.
- Cambio de turno realizado.
- Habilitación renovada.

Cada evento debe mostrar:

- icono de línea
- descripción
- usuario responsable
- fecha/hora

Agregar:

"Ver historial completo"

que navegue a:

"Trazabilidad / Auditoría"

No crear un sistema de auditoría nuevo dentro del Dashboard.

---

### 8. ACCESOS RÁPIDOS

Crear una sección compacta:

"Accesos rápidos"

Opciones:

- Gestión de usuarios y cuentas
- Habilitaciones y certificaciones
- Carnets y permisos aeroportuarios
- Horarios y disponibilidad
- Reportes

Cada acceso debe llevar directamente a su módulo.

Mantenerlas visualmente ligeras.

No crear grandes cards decorativas.

---

LAYOUT DESKTOP:

1440px+:

Fila superior:
4 KPI cards.

Área inferior organizada en un grid equilibrado:

Columna izquierda:
Vencimientos próximos.

Columna derecha:
Distribución del personal / disponibilidad.

Siguiente fila:

Cuentas pendientes de activar.

Actividad reciente.

Accesos rápidos pueden ocupar una sección compacta según el espacio disponible.

El resultado debe sentirse como un dashboard enterprise real, no como una colección de tarjetas independientes.

---

RESPONSIVE:

Desktop 1440px+:

- 4 KPI cards.
- Layout de contenido en 2 columnas.
- Gráficos correctamente dimensionados.

Tablet 1024px:

- KPIs 2x2.
- Contenido apilado o adaptado a 1-2 columnas.
- Tablas/listas reducidas cuando sea necesario.

Mobile:

No es prioritario para este entorno, pero:

- evitar overflow horizontal
- mantener contenido usable
- convertir grids en una sola columna

---

MICROINTERACCIONES:

Reutilizar las microinteracciones existentes en Admin/OCC.

Incluir:

- conteo ascendente de KPIs
- hover elevation sutil
- transición de cards
- skeleton loaders
- fade al actualizar datos
- tooltips
- focus states accesibles

La KPI de vencidos puede tener un leve aumento de contraste o pulso sutil cuando el valor sea mayor que cero.

NO utilizar parpadeos agresivos.

---

ESTADOS A SOPORTAR:

### Estado normal

Datos mixtos:

- algunos vencimientos
- algunas cuentas pendientes
- personal distribuido

### Estado "todo al día"

No existen vencimientos próximos ni vencidos.

Mostrar:

"No hay vencimientos pendientes"

El estado debe sentirse positivo pero corporativo, sin emojis.

### Estado crítico

Existen documentos/habilitaciones vencidos.

La KPI de vencidos debe destacarse.

El panel de vencimientos debe priorizar los elementos críticos.

### Estado de carga

Skeleton loaders para:

- KPIs
- listas
- gráficos
- actividad reciente

Reutilizar los skeletons existentes.

### Estado de error

Mostrar:

"No fue posible cargar el resumen"

con acción:

"Reintentar"

---

DATOS:

Utilizar mocks realistas inicialmente.

La estructura de los mocks debe representar una respuesta futura de API REST.

Separar claramente:

- types/interfaces
- mock data
- componentes
- servicios/API

No crear lógica backend.

No inventar endpoints definitivos.

El objetivo es que posteriormente los mocks puedan sustituirse fácilmente por llamadas reales.

---

COMPONENTES:

Primero buscar componentes reutilizables en la rama actual y en `feat/adminocc`.

Preferir reutilizar:

- `KpiCard`
- `StatusBadge`
- componentes de gráficos
- cards
- skeleton loaders
- activity/alert feed
- botones
- tooltips

Solo crear nuevos componentes cuando realmente sean necesarios.

Posibles componentes nuevos:

- `ExpirationList`
- `ExpirationListItem`
- `StaffDistributionChart`
- `PersonnelAvailability`
- `PendingAccountsList`
- `AuditActivityFeed`
- `HRQuickActions`

No crear duplicados si ya existe una versión suficientemente genérica.

---

RUTAS:

Integrar el Dashboard dentro del Home/Sidebar de Gestión Humana ya construido.

No modificar las rutas de Admin/OCC.

No modificar el login general.

No reconstruir el shell.

---

CRITERIOS DE CALIDAD:

Antes de finalizar:

1. Verifica modo claro.
2. Verifica modo oscuro.
3. Verifica responsive desktop/tablet.
4. Verifica loading.
5. Verifica estado crítico.
6. Verifica estado "todo al día".
7. Verifica navegación de los accesos rápidos.
8. Verifica que no existan errores de consola.
9. Ejecuta lint/build/tests disponibles.
10. Verifica que no se hayan roto las rutas existentes.
11. Verifica que Admin/OCC no haya sido modificado accidentalmente.

---

RESTRICCIONES EXPLÍCITAS:

- No crear login.
- No crear otro AppShell.
- No crear otro Sidebar.
- No modificar Admin/OCC.
- No duplicar componentes existentes.
- No instalar librerías nuevas sin necesidad.
- No utilizar emojis.
- No utilizar iconografía decorativa.
- No utilizar colores fuera de la paleta.
- No crear información real ni sensible.
- Mantener modo claro/oscuro.
- Mantener accesibilidad básica.
- Mantener consistencia absoluta con ELEVANT.

---

PROCEDIMIENTO FINAL OBLIGATORIO:

ANTES DE PROGRAMAR:

1. Inspecciona la rama actual.
2. Inspecciona `feat/adminocc`.
3. Revisa el Dashboard de Admin/OCC.
4. Revisa `KpiCard`, gráficos, StatusBadge y feed de actividad.
5. Revisa el Home/Sidebar actual de Gestión Humana.
6. Identifica qué componentes pueden reutilizarse.
7. Identifica la ruta exacta donde debe vivir el Dashboard.
8. Explica brevemente el plan de implementación.

DESPUÉS:

9. Implementa el Dashboard.
10. Ejecuta lint/build/tests disponibles.
11. Corrige errores encontrados.
12. Verifica visualmente los estados principales.
13. Resume al finalizar:

- archivos creados
- archivos modificados
- componentes reutilizados desde Admin/OCC
- componentes nuevos
- funcionalidades implementadas
- pruebas ejecutadas
- pendientes para integración con backend