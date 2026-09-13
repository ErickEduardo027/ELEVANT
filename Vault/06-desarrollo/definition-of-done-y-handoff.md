---
id: desarrollo-definition-of-done-handoff
title: "Definition of Done y handoff"
type: policy
area: development
status: verified
maturity: stable
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-09-12"
verified_commit: "c2a060179983a13b7e5a0dd45cba1a1fd2e54e8a"
sources:
  - AGENTS.md
  - CONTRIBUTING.md
  - .github/pull_request_template.md
  - docs/workflows/git-workflow.md
  - docs/workflows/pull-requests.md
  - docs/workflows/local-development.md
  - backend/README.md
  - frontend/private-web/package.json
  - frontend/public-web/package.json
  - frontend/mobile-agent/package.json
  - packages/api-client/package.json
tags:
  - desarrollo
  - definition-of-done
  - handoff
  - calidad
---

# Definition of Done y handoff

“Funciona en mi máquina” no cierra un cambio. Done significa que el alcance es
entendible, el código respeta sus fronteras, la evidencia local es reproducible
y el PR informa con precisión lo que todavía depende de CI, review, merge o
release.

## Definition of Done universal

- [ ] El trabajo ordinario parte de `Development`; un `hotfix/*` originado en
      Production sigue su proceso explícito desde `main`. El diff pertenece al
      alcance acordado.
- [ ] Se leyeron los `AGENTS.md`, README, manifests y fuentes autoritativas del
      subárbol.
- [ ] No se duplicó backend/base por cliente ni se creó acceso directo cliente
      → SQL/proveedor.
- [ ] Las pruebas nuevas cubren éxito, rechazo y límites relevantes.
- [ ] Los comandos locales del subárbol terminan en cero.
- [ ] Locks, generated code y snapshot OpenAPI están sincronizados cuando
      corresponde; nada generado se editó a mano.
- [ ] Una modificación EF incluye migración revisada o demuestra que no hay
      cambios de modelo pendientes.
- [ ] La documentación durable y el Vault reflejan comportamiento, contrato,
      esquema o proceso modificado.
- [ ] No hay secretos, PII, hosts privados, backups, bases ni output runtime.
- [ ] `git diff` fue leído y `git status` no contiene archivos sorpresa.
- [ ] El PR declara riesgos, compatibilidad, evidencia y trabajo pendiente.
- [ ] No se afirma merge o despliegue si no ocurrió y no fue autorizado.

## Evidencia adicional por cambio

| Cambio | Evidencia que debe acompañarlo |
| --- | --- |
| Private/Public/Mobile | estados UI, validator/config, test/type/build disponible y seam API |
| API | tests, Problem Details/status, autorización/tenant y diff OpenAPI |
| Base de datos | migración + snapshot, clean/upgrade, pending-model y seed |
| Contrato compartido | Swagger compilado, generated diff y checks de tres consumidores |
| Coordinado | fases expand/contract, orden de compatibilidad y criterio de retirada |
| Vault/proceso | fuentes verificadas, links, inventario generado y `vault:ci` |

No inventes una casilla para un script que el paquete no posee. Por ejemplo,
Private Web no declara hoy lint/typecheck separados y Mobile Agent no declara
una suite general `test`; se reportan exactamente los scripts disponibles y la
deuda correspondiente.

## Inspección final segura

```powershell
git status --short --branch
git diff --check
git diff --stat
git diff --name-only
npm run check
```

Si cambió el Vault, añade:

```powershell
npm run vault:test
npm run vault:generate
npm run vault:check
```

Luego ejecuta los bloques aplicables de
[Comandos locales por subárbol](comandos-locales-por-subarbol.md). No pegues la
salida completa si contiene configuración o datos; resume resultado y conserva
solo el fragmento sanitizado necesario para un fallo.

## Handoff reproducible

Usa esta estructura en el PR o al entregar a otra persona:

```markdown
## Resultado
- Qué comportamiento quedó implementado.
- Qué quedó explícitamente fuera de alcance.

## Superficie
- Rama/commit revisado:
- Rutas modificadas:
- Contrato/esquema/consumidores afectados:

## Evidencia local
- `comando exacto` — PASS/FAIL, resumen y duración si aporta valor.

## CI y review pendientes
- Checks remotos que deben pasar:
- Decisiones o revisión especializada requerida:

## Riesgos y continuidad
- Compatibilidad/rollback lógico:
- Deuda o siguiente PR:

## Estado de entrega
- No fusionado.
- No desplegado.
```

Ajusta las dos últimas líneas solo con evidencia y autorización reales. Un PR
creado no equivale a merge; un merge no equivale automáticamente a que todos
los clientes estén publicados.

## Handoff de un bloqueo

Un bloqueo útil contiene:

- resultado esperado y observado;
- comando reproducible y exit code;
- versión de herramienta y commit;
- primera causa conocida, no solo el último error;
- logs sanitizados y archivos afectados;
- alternativas seguras intentadas;
- decisión o autoridad concreta que falta.

No marques una tarea “done” por falta de tiempo ni ocultes un check rojo. Si CI
falla, usa [Pruebas y frontera con CI](pruebas-calidad-y-frontera-ci.md); si la
reproducción local falla, usa [Depuración local](depuracion-local.md).
