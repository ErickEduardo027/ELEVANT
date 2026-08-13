# Backend prototipo ELEVANT

Servidor local de demostración que conecta el portal de aerolíneas, Contratos, Gestión Humana, OCC, la app móvil y Finanzas. Debe permanecer en la **raíz del repositorio**, junto a `frontend` y `backend`; no pertenece a `frontend` porque atiende a varios clientes.

## Persistencia

- `data/seed.json`: estado inicial versionado.
- `data/runtime.json`: estado de trabajo generado automáticamente y excluido de Git.
- Cada escritura se realiza primero en un archivo temporal y después se reemplaza el archivo de trabajo para reducir el riesgo de corrupción.
- Recompilar o reiniciar no elimina los datos. `POST /api/admin/reset` restaura la semilla.

> Es un prototipo local. Las contraseñas están en la semilla y no son adecuadas para producción.

## Ejecución

Requiere Node.js 22 LTS.

```powershell
cd backend-prototipo
npm ci
npm start
```

Servidor: `http://localhost:4310`. Salud: `http://localhost:4310/health`.

En otra terminal:

```powershell
cd frontend/web
npm ci
npm run dev
```

El sitio departamental abre en `http://localhost:5173`. El botón **Flujo integrado** abre las acciones compartidas y el chat interdepartamental.

Para el portal público, copie `.env.example` como `.env.local` y ejecute `npm ci` y `npm run dev`. Para un celular físico, copie `frontend/mobile-agent/.env.example` como `.env` y cambie la IP por la IPv4 de la computadora.

## Credenciales

| Área | Usuario | Contraseña |
|---|---|---|
| OCC | `admin@elevant.test` | `Elevant2026!` |
| Gestión Humana | `gestionhumana@elevant.test` | `Elevant2026!` |
| Contratos | `contratos@elevant.test` | `Elevant2026!` |
| Finanzas | `finanzas@elevant.test` | `Elevant2026!` |
| App móvil | `agente@elevant.test` | `Elevant2026!` |

## Pruebas

```powershell
cd backend-prototipo
npm test
cd ..\frontend\web
npm test -- --run
npm run build
```

Los reportes consolidados se descargan como PDF real o Excel `.xlsx` desde el Centro de flujo.
