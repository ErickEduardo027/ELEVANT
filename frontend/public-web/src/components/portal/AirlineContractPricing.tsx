"use client";

import { useEffect, useState } from "react";
import { ElevantApiError, type ContractPricingTermsResponse } from "@elevant/api-client";
import { useAirlineSession } from "@/components/auth/AirlineSessionProvider";
import { billingUnitLabel } from "@/lib/billing-units";
import styles from "./AirlinePortalPage.module.css";

type Charge = ContractPricingTermsResponse["charges"][number];
type Package = ContractPricingTermsResponse["packages"][number];

/** How each surcharge is computed; an unknown method or rule is shown as its code. */
const METHODS: Readonly<Record<string, string>> = Object.freeze({
  FixedAmount: "Monto fijo", PercentOfService: "Porcentaje del servicio", PerHour: "Por hora", PerMinute: "Por minuto",
});
const RULES: Readonly<Record<string, string>> = Object.freeze({
  ServiceDuration: "según la duración del servicio", OperationOverrun: "según el exceso de la operación",
  ArrivalDelay: "según el retraso de la llegada", ServiceQuantity: "según la cantidad del servicio",
});

function money(amount: number, currency: string) {
  return new Intl.NumberFormat("es-DO", { style: "currency", currency }).format(amount);
}

function basis(charge: Charge) {
  const method = charge.method === "PerUnit" ? `Por ${billingUnitLabel(charge.billingUnit)}` : METHODS[charge.method] ?? charge.method;
  return [method, RULES[charge.quantityRule], charge.graceMinutes > 0 ? `${charge.graceMinutes} min de gracia` : null]
    .filter(Boolean).join(", ");
}

function value(charge: Charge, currency: string) {
  if (charge.isExcluded) return "Exento";
  if (charge.value == null) return "Tarifa general";
  const amount = charge.method === "PercentOfService" ? `${charge.value} %` : money(charge.value, currency);
  return charge.minimumAmount ? `${amount} · mínimo ${money(charge.minimumAmount, currency)}` : amount;
}

function scope(item: Package) {
  if (item.scope === "Turnaround") return "Por escala";
  if (item.scope === "Flight") return item.flightDirection === "Arrival" ? "Por vuelo de llegada"
    : item.flightDirection === "Departure" ? "Por vuelo de salida" : "Por vuelo";
  if (item.scope === "Period") return item.periodDays ? `Por período de ${item.periodDays} días` : "Por período";
  return item.scope;
}

type State = { status: "loading" } | { status: "ready"; terms: ContractPricingTermsResponse } |
  { status: "error" } | { status: "unauthorized" };

/**
 * Surcharges and packages of one approved contract version (2-N04), as they apply when AVIAM bills: whether
 * they are part of the content both parties signed, or of the content still to sign.
 */
export function AirlineContractPricing({ versionId }: { versionId: string }) {
  const { getContractPricingTerms } = useAirlineSession();
  const [state, setState] = useState<State>({ status: "loading" });
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    getContractPricingTerms(versionId)
      .then(terms => { if (active) setState({ status: "ready", terms }); })
      .catch(error => {
        if (!active) return;
        setState({ status: error instanceof ElevantApiError && (error.status === 403 || error.status === 404)
          ? "unauthorized" : "error" });
      });
    return () => { active = false; };
  }, [getContractPricingTerms, versionId, revision]);

  const retry = () => { setState({ status: "loading" }); setRevision(value => value + 1); };

  return <section className={styles.contractVersion} aria-label="Recargos y paquetes">
    <h3>Recargos y paquetes</h3>
    {state.status === "loading" && <p role="status">Cargando recargos y paquetes…</p>}
    {state.status === "unauthorized" &&
      <p role="alert">Su cuenta no puede consultar los recargos y paquetes de esta versión.</p>}
    {state.status === "error" && <p role="alert">No se pudieron cargar los recargos y paquetes.{" "}
      <button type="button" onClick={retry}>Reintentar</button></p>}
    {state.status === "ready" && <PricingTerms terms={state.terms} />}
  </section>;
}

function PricingTerms({ terms }: { terms: ContractPricingTermsResponse }) {
  if (terms.charges.length === 0 && terms.packages.length === 0)
    return <p className={styles.empty}>Esta versión no tiene recargos ni paquetes.</p>;
  return <>
    <p className={styles.note}>{terms.signed
      ? "Forman parte del contenido que firmaron ambas partes."
      : terms.inDocument
        ? "Forman parte del contenido a firmar: revíselos en el PDF antes de firmar."
        : "No forman parte del contenido firmado de esta versión; son las condiciones con las que AVIAM factura."}</p>
    {terms.charges.length > 0 && <ul className={styles.draftComments} aria-label="Recargos">
      {terms.charges.map(charge => <li key={charge.chargeCode}>
        <strong>{charge.chargeName}</strong> <small>{charge.chargeCode}</small>
        <p>{basis(charge)} · {value(charge, terms.currencyCode)}</p>
      </li>)}
    </ul>}
    {terms.packages.length > 0 && <ul className={styles.draftComments} aria-label="Paquetes">
      {terms.packages.map(item => <li key={`${item.code}-${item.versionNumber}`}>
        <strong>{item.name}</strong> <small>{item.code} v{item.versionNumber}</small>
        <p>{scope(item)} · precio base {money(item.basePrice, item.currencyCode)}</p>
        {item.components.length > 0 && <p>Incluye: {item.components.map(component =>
          `${component.serviceName} (${component.includedQuantity} ${billingUnitLabel(component.billingUnit)})` +
          (component.excessBlockPrice > 0 ? `, exceso ${money(component.excessBlockPrice, item.currencyCode)} por cada ` +
            `${component.excessBlockSize} ${billingUnitLabel(component.billingUnit)}` : "")).join("; ")}</p>}
      </li>)}
    </ul>}
  </>;
}
