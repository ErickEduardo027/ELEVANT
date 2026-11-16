#!/usr/bin/env node
// Draws the fallback illustration of each ground-handling service type (catering, baggage,
// fuel…) used when a service has no photo or its photo cannot load. Plain SVG, no external
// assets, written to both web apps so they stay identical.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TARGETS = ['frontend/private-web/public/assets/services/illustrations', 'frontend/public-web/public/assets/services/illustrations'];

const stroke = 'fill="none" stroke="#FFFFFF" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"';
const accent = 'fill="none" stroke="#F26B1D" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"';

// Icons drawn in a 200×200 box.
const ICONS = {
  catering: `<rect x="40" y="70" width="120" height="80" rx="10" ${stroke}/><path d="M40 98h120M40 124h120" ${stroke}/><circle cx="62" cy="168" r="12" ${accent}/><circle cx="138" cy="168" r="12" ${accent}/><path d="M78 52c0-12 8-12 8-24M100 52c0-12 8-12 8-24M122 52c0-12 8-12 8-24" ${accent}/>`,
  baggage: `<rect x="45" y="65" width="110" height="95" rx="14" ${stroke}/><path d="M78 65V45h44v20M75 65v95M125 65v95" ${stroke}/><circle cx="68" cy="172" r="8" ${accent}/><circle cx="132" cy="172" r="8" ${accent}/>`,
  cargo: `<rect x="30" y="95" width="70" height="65" ${stroke}/><rect x="100" y="95" width="70" height="65" ${stroke}/><rect x="65" y="35" width="70" height="60" ${stroke}/><path d="M65 120h0M135 120h0M100 60h0" ${accent}/>`,
  cleaning: `<path d="M120 30l-40 95" ${stroke}/><path d="M50 125h70l15 45H35z" ${stroke}/><path d="M60 170l5-30M85 170l2-30M110 170l-2-30" ${accent}/>`,
  fuel: `<path d="M100 30c30 40 50 65 50 92a50 50 0 0 1-100 0c0-27 20-52 50-92z" ${stroke}/><path d="M78 125a24 24 0 0 0 24 24" ${accent}/>`,
  pmr: `<circle cx="95" cy="40" r="14" ${accent}/><path d="M95 58v52h45l20 45" ${stroke}/><path d="M95 80h40" ${stroke}/><path d="M80 95a45 45 0 1 0 55 62" ${stroke}/>`,
  power: `<path d="M115 25L60 110h40l-15 65 55-90h-40z" ${accent}/><rect x="40" y="150" width="120" height="25" rx="6" ${stroke}/>`,
  aircon: `<path d="M100 25v150M35 62l130 76M35 138l130-76" ${stroke}/><path d="M85 35l15 15 15-15M85 165l15-15 15 15" ${accent}/>`,
  stairs: `<path d="M35 170h35v-30h30v-30h30V80h35" ${stroke}/><path d="M60 170L160 50" ${accent}/><circle cx="55" cy="178" r="7" ${accent}/><circle cx="150" cy="178" r="7" ${accent}/>`,
  towing: `<rect x="30" y="100" width="95" height="45" rx="8" ${stroke}/><path d="M50 100V75h45l15 25" ${stroke}/><path d="M125 122h45" ${accent}/><circle cx="55" cy="155" r="14" ${stroke}/><circle cx="105" cy="155" r="14" ${stroke}/>`,
  marshalling: `<circle cx="100" cy="45" r="14" ${stroke}/><path d="M100 60v60l-25 50M100 120l25 50M100 80l-55-35M100 80l55-35" ${stroke}/><path d="M40 40l-12-8M160 40l12-8" ${accent}/>`,
  boarding: `<path d="M30 140h140M50 140V90h100v50" ${stroke}/><circle cx="85" cy="60" r="12" ${accent}/><path d="M85 75v30M70 120l15-15 15 15" ${accent}/><path d="M120 115h30l-10-10M150 115l-10 10" ${stroke}/>`,
  aircraft: `<path d="M100 25c8 0 12 10 12 22v35l58 30v18l-58-15v35l18 14v14l-30-9-30 9v-14l18-14v-35l-58 15v-18l58-30V47c0-12 4-22 12-22z" ${stroke}/>`,
};

const LABELS = {
  catering: 'Catering', baggage: 'Equipaje', cargo: 'Carga', cleaning: 'Limpieza', fuel: 'Combustible',
  pmr: 'Asistencia PMR', power: 'Energía en tierra', aircon: 'Aire acondicionado', stairs: 'Escaleras',
  towing: 'Remolque', marshalling: 'Señalización', boarding: 'Embarque', aircraft: 'Servicio en rampa',
};

function svg(kind) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" role="img" aria-label="Ilustración: ${LABELS[kind]}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0B2A5B"/><stop offset="1" stop-color="#123F86"/></linearGradient></defs>
  <rect width="640" height="360" fill="url(#g)"/>
  <path d="M0 300C160 250 320 330 640 270V360H0z" fill="#F26B1D" opacity=".18"/>
  <circle cx="520" cy="70" r="140" fill="#FFFFFF" opacity=".05"/>
  <g transform="translate(220 50) scale(1)">${ICONS[kind]}</g>
  <text x="320" y="315" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="700" fill="#FFFFFF" letter-spacing="1">${LABELS[kind].toUpperCase()}</text>
</svg>
`;
}

for (const target of TARGETS) {
  const directory = resolve(root, target);
  mkdirSync(directory, { recursive: true });
  for (const kind of Object.keys(ICONS)) writeFileSync(resolve(directory, `${kind}.svg`), svg(kind));
}
console.log(`${Object.keys(ICONS).length} illustrations written to ${TARGETS.length} apps.`);
