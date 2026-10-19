---
id: aplicaciones-acceso-animado-certificacion
title: "Acceso animado y certificación de AVIAM Web"
type: architecture
area: private-web
status: verified
maturity: evolving
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-10-19"
verified_commit: "cc4bdeb12b66f74c957e810f9b84fdf543f5e3e4"
sources:
  - frontend/private-web/src/features/auth/components/LoginIntro.jsx
  - frontend/private-web/src/features/auth/components/AirportShowcase.jsx
  - frontend/private-web/src/features/auth/AuthVisualLayout.jsx
  - frontend/private-web/src/features/auth/LoginPage.css
  - frontend/private-web/src/features/auth/components/LoginShowcase.test.jsx
  - frontend/private-web/scripts/verify-auth-motion.mjs
  - frontend/private-web/scripts/certify-image.sh
  - frontend/private-web/Dockerfile
  - frontend/private-web/README.md
  - .github/workflows/web-ci.yml
tags:
  - acceso
  - animacion
  - accesibilidad
  - entrega
---

# Acceso animado y certificación de AVIAM Web

El acceso conserva la identidad ELEVANT, las fotografías de aeropuerto y
los seis logos de aerolíneas en recursos propios de `public/`. El Dockerfile
copia esos recursos a la imagen standalone. Esta nota describe código y
certificación versionados; no acredita una promoción ni una aceptación visual
posterior en el VPS.

## Inicio sin depender de la velocidad de red

La introducción espera a que las imágenes del isotipo estén cargadas antes
de iniciar sus 2,7 segundos de animación. Durante esa preparación el formulario
sigue disponible, sin una capa que intercepte la interacción. Tecla, puntero,
clic o foco cancelan la introducción, incluida una activación mediante tecnología
de asistencia. Una imagen fallida o una espera de 20 segundos la omiten.

Se presenta una vez por documento; una recarga completa puede reproducirla
de nuevo. Ya no se consulta ni escribe el antiguo indicador de `sessionStorage`.
Los remontajes de la pantalla dentro del mismo documento no la repiten. No se
añade una espera a la autenticación ni se modifica su contrato.

## Carrusel y accesibilidad

Se conservan los seis PNG originales, su orden, sus proporciones y la franja
horizontal. Dos grupos idénticos comparten ancho y espaciado para que el
desplazamiento automático de 38 segundos por vuelta se una sin saltos.
Un botón traducido a español/inglés pausa o reanuda el movimiento y comunica
el estado con `aria-pressed`; el grupo duplicado es decorativo.

Por decisión explícita de producto, la introducción y el carrusel arrancan
automáticamente incluso cuando el sistema declara movimiento reducido.
Esa preferencia no oculta la introducción ni el control y no convierte los
logos en una cuadrícula. La pausa es voluntaria, se conserva al cambiar tema
o idioma y se reinicia al recargar el documento. Esta regla se limita al logo
de bienvenida y al carrusel del acceso; no establece la política de movimiento
de los demás módulos.

## Evidencia exigida antes de publicar

`certify-image.sh` descarga y compara los bytes del isotipo, los seis logos
y las fotografías con el código revisado. Después ejecuta Chromium contra el
contenedor exacto: comprueba carga lenta, recarga aun con el indicador heredado,
entrada de credenciales sin interrupción y unión del último fotograma con el
siguiente ciclo. La matriz cubre escritorio, tablet y móvil, ambos temas e
idiomas, y tres preferencias: sistema sin emulación, `no-preference` y `reduce`.
En todas exige una sola fila, proporciones originales y desplazamiento real;
una cuadrícula estática hace fallar la certificación. Comprueba asimismo que
la pausa detenga el movimiento y se conserve al cambiar tema o idioma.
La medición espera a que el motor confirme la pausa mediante `Animation.ready`;
después exige tiempo y transformación inmutables durante varios fotogramas.
Una comprobación negativa rechaza un carrusel reanudado. La prueba del límite
del bucle conserva el control CSS de la reproducción para no interferir con
las comprobaciones posteriores del botón.
No necesita credenciales ni una API disponible y no permite peticiones a
servicios externos.

El workflow instala la versión de Chromium fijada por el lockfile tanto en
construcción como en publicación. La imagen transferida se vuelve a certificar
antes y después de publicarla por digest. Una falla impide certificarla; no se
deduce su estado de que una animación funcione únicamente en `next dev`.

Véanse los comandos en el [README de AVIAM Web](../../frontend/private-web/README.md)
y la [cadena de artefactos y promoción](../07-entrega/cadena-de-artefactos-y-promocion.md).
