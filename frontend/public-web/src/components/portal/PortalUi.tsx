"use client";

import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";

import styles from "./AirlinePortalPage.module.css";

/**
 * The one set of actions and tables of the airline portal's billing: a primary button per view, secondary and ghost
 * ones beside it in a group aligned to the right, and tables with a header, figures aligned to the right, a status
 * badge, a totals row and a stacked version on phones (each cell names its column).
 */
export type ButtonVariant = "primary" | "secondary" | "ghost";

export function Button({ variant = "secondary", className, type = "button", ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button type={type} className={className ? `${styles.button} ${className}` : styles.button}
    data-variant={variant} {...props} />;
}

export function ButtonLink({ variant = "secondary", className, ...props }:
  ComponentProps<typeof Link> & { variant?: ButtonVariant }) {
  return <Link prefetch={false} className={className ? `${styles.button} ${className}` : styles.button}
    data-variant={variant} {...props} />;
}

/** The actions of a header, a form or a row, aligned to the right; the primary one goes last. */
export function ActionGroup({ children, label }: { children: ReactNode; label?: string }) {
  return <div className={styles.actionGroup} role={label ? "group" : undefined} aria-label={label}>{children}</div>;
}

export type BadgeTone = "success" | "info" | "warning" | "danger" | "neutral";

export function StatusBadge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return <span className={styles.badge} data-tone={tone}>{children}</span>;
}

export interface Column<T> {
  key: string;
  /** The header; `label` names the column on phones when the header is not plain text. */
  header: ReactNode;
  label?: string;
  cell: (row: T) => ReactNode;
  /** A figure: aligned to the right with tabular digits. */
  numeric?: boolean;
  /** The cell of the totals row. */
  total?: ReactNode;
  /** The narrowest the column may get (a text column that should not break word by word). */
  minWidth?: string;
  /** Keeps the column's cells on one line, so it takes only the width it needs. */
  nowrap?: boolean;
}

export function DataTable<T>({ caption, columns, rows, rowKey, nested, empty, totalLabel }: {
  /** Names the table for assistive technology; it is not shown. */
  caption: string;
  columns: Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  /** A row that belongs to the one above it (a charge of a service). */
  nested?: (row: T) => boolean;
  /** Shown instead of the table without rows. */
  empty?: ReactNode;
  /** Adds a totals row: the label goes in the first column, each column's `total` in its own. */
  totalLabel?: ReactNode;
}) {
  if (rows.length === 0 && empty) return <p className={styles.empty}>{empty}</p>;
  const labelOf = (column: Column<T>) => column.label ?? (typeof column.header === "string" ? column.header : "");
  return <div className={styles.tableWrap}>
    <table className={styles.table} data-stack="">
      <caption className={styles.visuallyHidden}>{caption}</caption>
      <thead><tr>{columns.map(column =>
        <th key={column.key} scope="col" data-numeric={column.numeric ? "" : undefined}
        style={column.minWidth ? { minWidth: column.minWidth } : undefined}>{column.header}</th>)}</tr></thead>
      <tbody>{rows.map(row => <tr key={rowKey(row)} data-nested={nested?.(row) ? "" : undefined}>
        {columns.map(column => <td key={column.key} data-label={labelOf(column)}
          data-numeric={column.numeric ? "" : undefined} data-nowrap={column.nowrap ? "" : undefined}>{column.cell(row)}</td>)}
      </tr>)}</tbody>
      {totalLabel !== undefined && rows.length > 0 && <tfoot><tr>
        {columns.map((column, index) => index === 0
          ? <th key={column.key} scope="row" data-label="">{totalLabel}</th>
          : <td key={column.key} data-label={column.total === undefined ? "" : labelOf(column)}
            data-numeric={column.numeric ? "" : undefined}>{column.total}</td>)}
      </tr></tfoot>}
    </table>
  </div>;
}
