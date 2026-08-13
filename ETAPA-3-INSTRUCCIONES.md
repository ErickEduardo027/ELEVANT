# ELEVANT — Etapa 3: solicitudes de aerolíneas y Contratos

Esta entrega se aplica sobre `Feat/backend-agentes` y conserva los agentes y demás datos ya registrados.

## Funcionalidad incluida

- El formulario público de afiliación envía la solicitud al backend local.
- La solicitud queda almacenada en `backend-prototipo/data/runtime.json`.
- La bandeja **Solicitudes** del Departamento de Contratos consulta los datos reales del backend.
- Contratos puede marcar una solicitud en revisión.
- Contratos puede aprobarla o rechazarla con una observación obligatoria.
- La decisión y su fecha quedan persistidas.
- No se crea todavía el contrato: corresponde a la próxima etapa.

## Preparar la rama

```powershell
cd "C:\ELEVANT-DESARROLLO\ELEVANT"
git switch Feat/backend-agentes
git pull --ff-only origin Feat/backend-agentes
git switch -c Feat/backend-solicitudes
```

Extrae el ZIP directamente sobre la raíz del repositorio y permite reemplazar archivos.

## Ejecutar

Terminal 1:

```powershell
cd backend-prototipo
npm start
```

Terminal 2 — aplicación departamental:

```powershell
cd frontend\web
npm ci
npm run dev
```

Terminal 3 — portal público de aerolíneas:

```powershell
cd frontend\public-web
npm ci
npm run dev
```

Si ambos frontends intentan usar el mismo puerto, Next.js seleccionará otro automáticamente. Revisa la dirección que muestre cada terminal.

## Probar el flujo

1. Abre el portal público y entra en **Solicitar afiliación**.
2. Completa y envía una solicitud.
3. Abre la aplicación departamental e inicia sesión con `contratos@elevant.test` y `Elevant2026!`.
4. Entra en **Solicitudes** y abre la solicitud recién creada.
5. Márcala en revisión.
6. Apruébala o recházala registrando una observación.
7. Recarga la página y comprueba que el estado permanezca guardado.

## Confirmar y subir

```powershell
git add backend-prototipo frontend/web/src/services/contractRequestsService.js frontend/public-web/.env.example frontend/public-web/src/components/auth/MockSessionProvider.tsx frontend/public-web/src/components/auth/AuthExperience.tsx ETAPA-3-INSTRUCCIONES.md
git commit -m "feat(prototipo): integrar solicitudes de aerolineas con contratos"
git push -u origin HEAD
```

Pull Request:

- Base: `Feat/backend-agentes`
- Compare: `Feat/backend-solicitudes`
