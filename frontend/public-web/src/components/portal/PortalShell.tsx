"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type MouseEvent,
  type ReactNode,
  type SVGProps,
} from "react";

import { useAirlineSession } from "@/components/auth/AirlineSessionProvider";
import { BrandMark } from "@/components/marketing/BrandMark";

import {
  ChartIcon,
  ClipboardIcon,
  CloseIcon,
  FileIcon,
  FinanceIcon,
  HomeIcon,
  MenuIcon,
  MoreIcon,
  PlaneIcon,
  UserIcon,
} from "./PortalIcons";
import styles from "./PortalShell.module.css";

type NavigationItem = {
  href: string;
  label: string;
  shortLabel?: string;
  group: "Operación" | "Cuenta";
  icon: ComponentType<SVGProps<SVGSVGElement>>;
};

const NAVIGATION: NavigationItem[] = [
  { href: "/portal", label: "Inicio", group: "Operación", icon: HomeIcon },
  {
    href: "/portal/vuelos",
    label: "Vuelos",
    group: "Operación",
    icon: PlaneIcon,
  },
  {
    href: "/portal/solicitudes",
    label: "Solicitudes",
    group: "Operación",
    icon: ClipboardIcon,
  },
  {
    href: "/portal/contratos",
    label: "Contratos",
    group: "Operación",
    icon: FileIcon,
  },
  {
    href: "/portal/documentos",
    label: "Documentos",
    group: "Cuenta",
    icon: FileIcon,
  },
  {
    href: "/portal/finanzas",
    label: "Finanzas",
    group: "Cuenta",
    icon: FinanceIcon,
  },
  {
    href: "/portal/reportes",
    label: "Reportes",
    group: "Cuenta",
    icon: ChartIcon,
  },
  {
    href: "/portal/perfil",
    label: "Perfil",
    group: "Cuenta",
    icon: UserIcon,
  },
];

const MOBILE_NAVIGATION = [
  ...NAVIGATION.slice(0, 3),
  NAVIGATION.find((item) => item.href === "/portal/documentos")!,
];

function isCurrentRoute(pathname: string, href: string) {
  return href === "/portal"
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}

function currentPageTitle(pathname: string) {
  if (/^\/portal\/vuelos\/[^/]+/.test(pathname)) return "Detalle de vuelo";
  return NAVIGATION.find((item) => isCurrentRoute(pathname, item.href))?.label ?? "Portal";
}

function Navigation({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className={styles.navigation} aria-label="Navegación del portal">
      {(["Operación", "Cuenta"] as const).map((group) => (
        <div className={styles.navigationGroup} key={group}>
          <p>{group}</p>
          <ul>
            {NAVIGATION.filter((item) => item.group === group).map((item) => {
              const active = isCurrentRoute(pathname, item.href);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    className={styles.navigationLink}
                    data-active={active || undefined}
                    href={item.href}
                    prefetch={false}
                    aria-current={active ? "page" : undefined}
                    onClick={onNavigate}
                  >
                    <Icon />
                    <span>{item.label}</span>
                    {active && <i aria-hidden="true" />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function PortalShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { session, signOut } = useAirlineSession();

  const airline = session?.bootstrap.name || "Aerolínea";
  const userInitials = (session?.actor.displayName ?? "EA")
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  const closeDrawer = () => {
    dialogRef.current?.close();
    setDrawerOpen(false);
  };

  const openDrawer = () => {
    if (!dialogRef.current?.open) dialogRef.current?.showModal();
    setDrawerOpen(true);
  };

  useEffect(() => {
    const closeOnDesktop = () => {
      if (window.matchMedia("(min-width: 64rem)").matches) {
        dialogRef.current?.close();
      }
    };
    window.addEventListener("resize", closeOnDesktop);
    return () => window.removeEventListener("resize", closeOnDesktop);
  }, []);

  const handleDialogClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) closeDrawer();
  };

  const handleSignOut = () => {
    closeDrawer();
    signOut();
    window.location.replace("/login?mode=login");
  };

  return (
    <div className={styles.portalShell}>
      <a className={styles.skipLink} href="#portal-content">
        Saltar al contenido del portal
      </a>

      <aside className={styles.sidebar} aria-label="Navegación principal">
        <div className={styles.brandArea}>
          <BrandMark href="/portal" />
          <div className={styles.environmentBadge}>
            <span aria-hidden="true" />
            Portal autorizado
          </div>
        </div>
        <Navigation pathname={pathname} />
        <div className={styles.sidebarIdentity}>
          <span className={styles.avatar} aria-hidden="true">
            {userInitials}
          </span>
          <div>
            <strong>{session?.actor.displayName}</strong>
            <span>{airline}</span>
          </div>
          <button type="button" onClick={handleSignOut}>
            Cerrar sesión
          </button>
        </div>
      </aside>

      <div className={styles.workspace}>
        <header className={styles.topbar}>
          <button
            className={styles.menuButton}
            type="button"
            aria-haspopup="dialog"
            aria-controls="portal-navigation-drawer"
            aria-expanded={drawerOpen}
            aria-label="Abrir navegación"
            onClick={openDrawer}
          >
            <MenuIcon />
          </button>
          <div className={styles.topbarTitle}>
            <span>Portal de aerolíneas</span>
            <strong>{currentPageTitle(pathname)}</strong>
          </div>
          <div className={styles.topbarContext}>
            <span>Estación autorizada</span>
            <strong>{session?.bootstrap.stations.map((station) => station.code).join(", ") || "—"}</strong>
          </div>
          <button className={styles.noticeButton} type="button" disabled aria-label="Notificaciones no disponibles"
            title="Notificaciones pendientes de integración">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" /></svg>
          </button>
          <div className={styles.topbarUser} title={airline}>
            <span aria-hidden="true">{userInitials}</span>
            <div>
              <strong>{session?.actor.displayName}</strong>
              <small>{airline}</small>
            </div>
          </div>
        </header>

        <main className={styles.content} id="portal-content" tabIndex={-1}>
          {children}
        </main>
      </div>

      <dialog
        className={styles.drawer}
        id="portal-navigation-drawer"
        ref={dialogRef}
        aria-labelledby="portal-drawer-title"
        onClick={handleDialogClick}
        onClose={() => setDrawerOpen(false)}
      >
        <div className={styles.drawerPanel}>
          <div className={styles.drawerHeader}>
            <div>
              <span>Portal ELEVANT</span>
              <strong id="portal-drawer-title">Navegación</strong>
            </div>
            <button type="button" aria-label="Cerrar navegación" onClick={closeDrawer}>
              <CloseIcon />
            </button>
          </div>
          <div className={styles.drawerBrand}>
            <BrandMark href="/portal" compact />
          </div>
          <Navigation pathname={pathname} onNavigate={closeDrawer} />
          <div className={styles.drawerIdentity}>
            <span className={styles.avatar} aria-hidden="true">
              {userInitials}
            </span>
            <div>
              <strong>{session?.actor.displayName}</strong>
              <span>{airline}</span>
            </div>
            <button type="button" onClick={handleSignOut}>
              Cerrar sesión
            </button>
          </div>
        </div>
      </dialog>

      <nav className={styles.bottomNavigation} aria-label="Navegación móvil">
        {MOBILE_NAVIGATION.map((item) => {
          const active = isCurrentRoute(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              data-active={active || undefined}
              aria-current={active ? "page" : undefined}
            >
              <Icon />
              <span>{item.shortLabel ?? item.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          aria-haspopup="dialog"
          aria-controls="portal-navigation-drawer"
          aria-label="Abrir más secciones"
          onClick={openDrawer}
        >
          <MoreIcon />
          <span>Más</span>
        </button>
      </nav>
    </div>
  );
}
