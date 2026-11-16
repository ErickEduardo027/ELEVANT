import { useRef } from 'react';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import { useStackedTableLabels } from '../../components/StackedTable';

// Marco común de todas las áreas internas: el sidebar y el topbar quedan fijos
// y solo `main` desplaza su contenido. Así la navegación y el menú de usuario
// siguen visibles en páginas largas y los mapas pueden usar `h-full`.
// Las tablas `table-stack` del contenido reciben sus etiquetas de columna
// para apilarse como tarjetas en teléfono.
// Un departamento puede aportar su propio sidebar/topbar y su identidad visual
// (`department` → `data-department`, ver styles/occ.css) sin cambiar el marco
// que usan los demás. `rootAttributes` añade atributos a la raíz (el OCC pone
// `data-occ-bridge`, que enciende styles/occ-legacy-bridge.css); los del marco
// mandan sobre ellos.
// `mainVariant` elige cómo ocupa `main` su espacio: 'scroll' (por defecto, lo de
// siempre) desplaza el contenido con su margen interior; 'fill' lo deja sin
// margen ni desplazamiento para las pantallas de alto completo, como un mapa.
const DEFAULT_ROOT_CLASS = 'bg-surface-light text-text-primary-light dark:bg-surface-dark dark:text-text-primary-dark';
const MAIN_VARIANT_CLASS = Object.freeze({
  scroll: 'min-w-0 flex-1 overflow-y-auto overscroll-contain p-4 [animation:elevant-fade-in_180ms_ease-out] sm:p-6 3xl:px-10',
  fill: 'min-w-0 flex-1 overflow-hidden [animation:elevant-fade-in_180ms_ease-out]',
});

export default function ShellFrame({
  sidebarProps, topbarProps, mainKey, mainClassName = '', mainVariant = 'scroll', department, rootAttributes,
  SidebarComponent = Sidebar, TopbarComponent = Topbar, rootClassName = DEFAULT_ROOT_CLASS, children,
}) {
  const mainRef = useRef(null);
  useStackedTableLabels(mainRef, mainKey);
  if (!Object.hasOwn(MAIN_VARIANT_CLASS, mainVariant)) {
    throw new RangeError(`Unknown ShellFrame mainVariant: ${String(mainVariant)}`);
  }

  return (
    <div
      {...rootAttributes}
      data-shell-root=""
      data-department={department}
      className={`flex h-dvh overflow-hidden ${rootClassName}`}
    >
      <SidebarComponent {...sidebarProps} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopbarComponent {...topbarProps} />
        <main
          ref={mainRef}
          key={mainKey}
          id="main-content"
          data-shell-main=""
          className={`${MAIN_VARIANT_CLASS[mainVariant]} ${mainClassName}`}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
