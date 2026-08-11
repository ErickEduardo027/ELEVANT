"use client";

import { useEffect, useRef, useState, type SVGProps } from "react";
import { useRouter } from "next/navigation";

import { CheckIcon, CloseIcon } from "./PortalIcons";
import { usePortalWorkspace } from "./PortalWorkspace";
import styles from "./PortalNotifications.module.css";

function BellIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg aria-hidden="true" fill="none" focusable="false" viewBox="0 0 24 24" {...props}>
      <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z" />
      <path d="M10 21h4" />
    </svg>
  );
}

const CATEGORY_LABELS = {
  OPERATION: "Operación",
  DOCUMENT: "Documento",
  BILLING: "Finanzas",
  REQUEST: "Solicitud",
  SYSTEM: "Sistema",
} as const;

function relativeTime(value: string): string {
  const deltaMinutes = Math.round((Date.parse(value) - Date.now()) / 60_000);
  const formatter = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
  if (Math.abs(deltaMinutes) < 60) return formatter.format(deltaMinutes, "minute");
  const deltaHours = Math.round(deltaMinutes / 60);
  if (Math.abs(deltaHours) < 24) return formatter.format(deltaHours, "hour");
  return formatter.format(Math.round(deltaHours / 24), "day");
}

export function PortalNotifications() {
  const router = useRouter();
  const { data, mutate } = usePortalWorkspace();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const unread = data.notifications.filter((notification) => notification.readAt === null).length;

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (open && !rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const visitNotification = (id: string, href: string | null) => {
    mutate((repository) => repository.markNotificationRead(id));
    setOpen(false);
    if (href) router.push(href);
  };

  const markAllRead = () => {
    mutate((repository) => repository.markAllNotificationsRead());
  };

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        className={styles.trigger}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="portal-notifications"
        aria-label={unread ? `Notificaciones, ${unread} sin leer` : "Notificaciones"}
        onClick={() => setOpen((value) => !value)}
      >
        <BellIcon />
        {unread > 0 && <span aria-hidden="true">{unread > 9 ? "9+" : unread}</span>}
      </button>

      {open && (
        <section
          className={styles.popover}
          id="portal-notifications"
          role="dialog"
          aria-label="Centro de notificaciones"
        >
          <header>
            <div>
              <span>Actividad reciente</span>
              <strong>Notificaciones</strong>
            </div>
            <button type="button" aria-label="Cerrar notificaciones" onClick={() => setOpen(false)}>
              <CloseIcon />
            </button>
          </header>

          {unread > 0 && (
            <button className={styles.markAll} type="button" onClick={markAllRead}>
              <CheckIcon /> Marcar todas como leídas
            </button>
          )}

          <ol className={styles.list}>
            {data.notifications.length ? data.notifications.slice(0, 12).map((notification) => (
              <li key={notification.id} data-unread={notification.readAt === null || undefined}>
                <button
                  type="button"
                  onClick={() => visitNotification(notification.id, notification.href)}
                >
                  <span className={styles.category}>{CATEGORY_LABELS[notification.category]}</span>
                  <strong>{notification.title}</strong>
                  <p>{notification.message}</p>
                  <small>{relativeTime(notification.createdAt)}</small>
                </button>
              </li>
            )) : (
              <li className={styles.empty}>No hay notificaciones para esta sesión.</li>
            )}
          </ol>
        </section>
      )}
    </div>
  );
}
