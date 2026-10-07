import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';

// Marco común de todas las áreas internas: el sidebar y el topbar quedan fijos
// y solo `main` desplaza su contenido. Así la navegación y el menú de usuario
// siguen visibles en páginas largas y los mapas pueden usar `h-full`.
export default function ShellFrame({ sidebarProps, topbarProps, mainKey, mainClassName = '', children }) {
  return (
    <div
      data-shell-root=""
      className="flex h-dvh overflow-hidden bg-surface-light text-text-primary-light dark:bg-surface-dark dark:text-text-primary-dark"
    >
      <Sidebar {...sidebarProps} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar {...topbarProps} />
        <main
          key={mainKey}
          id="main-content"
          data-shell-main=""
          className={`min-w-0 flex-1 overflow-y-auto overscroll-contain p-4 [animation:elevant-fade-in_180ms_ease-out] sm:p-6 3xl:px-10 ${mainClassName}`}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
