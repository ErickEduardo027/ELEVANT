# Guía para clonar y crear la rama `backend-prototipo`

## 1. Clonar en otra ubicación

No copie encima de su carpeta actual. En PowerShell:

```powershell
cd "C:\Users\Eliezer\Documents"
git clone https://github.com/ErickEduardo027/ELEVANT.git ELEVANT-PROTOTIPO
cd ELEVANT-PROTOTIPO
git switch Development
git pull --ff-only origin Development
git switch -c backend-prototipo
```

Si la rama ya existe en GitHub:

```powershell
git fetch origin
git switch --track origin/backend-prototipo
```

## 2. Copiar esta entrega

Descomprima el ZIP dentro de `ELEVANT-PROTOTIPO`, aceptando reemplazar los archivos indicados. La estructura debe quedar así:

```text
ELEVANT-PROTOTIPO/
  backend/
  backend-prototipo/
  frontend/
```

No mueva `backend-prototipo` dentro de `frontend`.

## 3. Revisar y publicar

```powershell
git status
git add backend-prototipo frontend/web frontend/public-web frontend/mobile-agent GUIA-BACKEND-PROTOTIPO.md INICIAR-PROTOTIPO.cmd INSTALAR-PROTOTIPO.cmd
git commit -m "feat: integrar backend prototipo y flujo operativo"
git push -u origin HEAD
```

En GitHub cree el Pull Request con:

- **base:** `Development`
- **compare:** `backend-prototipo`

No incluya `node_modules`, `dist`, `.next`, archivos `.env` ni `backend-prototipo/data/runtime.json`.

## 4. Instalar e iniciar

Ejecute una sola vez `INSTALAR-PROTOTIPO.cmd`. Después ejecute `INICIAR-PROTOTIPO.cmd` para abrir backend, web departamental y portal público en terminales separadas.

Para Expo, copie `frontend/mobile-agent/.env.example` como `.env`, coloque la IPv4 de la computadora y ejecute desde esa carpeta:

```powershell
npx expo start --tunnel --clear
```
