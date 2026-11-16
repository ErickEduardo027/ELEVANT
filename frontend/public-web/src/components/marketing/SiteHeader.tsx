"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";

import { es } from "@/content/es";

import { BrandMark } from "./BrandMark";

type SiteHeaderProps = {
  subpage?: boolean;
};

export function SiteHeader({ subpage = false }: SiteHeaderProps) {
  const [open, setOpen] = useState(false);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const closeMenu = () => setOpen(false);

  return (
    <header className="site-header" data-open={open ? "true" : "false"}>
      <div className="site-header__inner shell">
        <BrandMark />

        <button
          className="menu-toggle"
          type="button"
          aria-expanded={open}
          aria-controls={menuId}
          aria-label={open ? "Cerrar navegación" : "Abrir navegación"}
          onClick={() => setOpen((current) => !current)}
        >
          <span aria-hidden="true" />
          <span aria-hidden="true" />
        </button>

        <nav
          className="site-navigation"
          id={menuId}
          aria-label="Navegación principal"
        >
          <div className="site-navigation__links">
            {es.navigation.map((item) => (
              <Link
                href={subpage ? `/${item.href}` : item.href}
                key={item.href}
                onClick={closeMenu}
              >
                {item.label}
              </Link>
            ))}
          </div>

          <div className="site-navigation__actions">
            <Link
              className="button button--secondary button--small nav-login"
              href={subpage ? "/solicitar-acceso" : "/login"}
              onClick={closeMenu}
            >
              {subpage ? "Solicitar acceso" : "INICIAR SESIÓN"}
            </Link>
            {!subpage && (
              <Link className="button button--small" href="/solicitar-acceso" onClick={closeMenu}>
                Solicitar acceso
                <ArrowIcon />
              </Link>
            )}
          </div>
        </nav>
      </div>
    </header>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 10h11M11 5l5 5-5 5" />
    </svg>
  );
}
