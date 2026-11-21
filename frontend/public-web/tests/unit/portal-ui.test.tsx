import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import { ActionGroup, Button, DataTable, StatusBadge } from "@/components/portal/PortalUi";
import { portalDeclarations } from "./support/portal-styles";

afterEach(cleanup);

type Row = { id: string; name: string; total: number };
const rows: Row[] = [{ id: "a", name: "Rampa", total: 1200 }, { id: "b", name: "Recargo", total: 30.5 }];

it("draws a table with its header, figures to the right, a totals row and the column of each cell for phones", () => {
  render(<DataTable caption="Líneas de la factura" rows={rows} rowKey={row => row.id} nested={row => row.id === "b"}
    totalLabel="Total" columns={[
      { key: "name", header: "Servicio", cell: row => row.name },
      { key: "total", header: "Importe", numeric: true, cell: row => row.total.toFixed(2), total: "1230.50" },
    ]} />);
  const table = screen.getByRole("table", { name: "Líneas de la factura" });
  expect(within(table).getAllByRole("columnheader").map(cell => cell.textContent)).toEqual(["Servicio", "Importe"]);
  const [, first, second, totals] = within(table).getAllByRole("row");
  expect(within(first).getByText("1200.00")).toHaveAttribute("data-numeric");
  expect(within(first).getByText("1200.00")).toHaveAttribute("data-label", "Importe");
  expect(second).toHaveAttribute("data-nested");
  expect(totals).toHaveTextContent("Total1230.50");
  expect(within(totals).getByRole("rowheader")).toHaveTextContent("Total");
});

it("says the table is empty instead of drawing a header without rows", () => {
  render(<DataTable caption="Pagos" rows={[]} rowKey={(row: Row) => row.id} empty="Sin pagos registrados."
    columns={[{ key: "name", header: "Pago", cell: row => row.name }]} />);
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(screen.getByText("Sin pagos registrados.")).toBeInTheDocument();
});

it("styles the primary, secondary and ghost buttons from one rule, grouped to the right", () => {
  render(<ActionGroup label="Acciones de la factura">
    <Button variant="ghost">Volver</Button><Button>Descargar PDF</Button><Button variant="primary">Pagar</Button>
  </ActionGroup>);
  const group = screen.getByRole("group", { name: "Acciones de la factura" });
  expect(portalDeclarations(group)).toContain("justify-content: flex-end");
  const primary = screen.getByRole("button", { name: "Pagar" });
  expect(primary).toHaveAttribute("data-variant", "primary");
  expect(primary).toHaveAttribute("type", "button");
  expect(screen.getByRole("button", { name: "Descargar PDF" })).toHaveAttribute("data-variant", "secondary");
  expect(portalDeclarations(primary)).toContain("border-radius: var(--radius-sm)");
});

it("names a status with a badge of its tone", () => {
  render(<StatusBadge tone="danger">Vencida</StatusBadge>);
  expect(screen.getByText("Vencida")).toHaveAttribute("data-tone", "danger");
});
