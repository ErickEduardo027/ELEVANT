"use client";

import { useMemo, useState } from "react";

import { downloadPortalCsv } from "@/lib/portal-documents";

import { FileIcon, SearchIcon } from "./PortalIcons";
import {
  EmptyState,
  formatDate,
  formatMoney,
  Panel,
  PortalPageHeader,
  Provenance,
  StatusBadge,
  portalModuleStyles as styles,
} from "./PortalModuleUI";
import { usePortalWorkspace } from "./PortalWorkspace";

const UNIT_LABELS = {
  SERVICE: "Servicio",
  MINUTE: "Minuto",
  UNIT: "Unidad",
  PERSON: "Persona",
} as const;

export function PortalContracts() {
  const { data } = usePortalWorkspace();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const [station, setStation] = useState("ALL");

  const stations = useMemo(
    () => [...new Set(data.contracts.flatMap((contract) => contract.stations))].sort(),
    [data.contracts],
  );

  const contracts = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("es");
    return data.contracts.filter((contract) => {
      const matchesQuery =
        normalizedQuery.length === 0 ||
        [contract.contractNumber, contract.title, ...contract.stations]
          .join(" ")
          .toLocaleLowerCase("es")
          .includes(normalizedQuery);
      const matchesStatus = status === "ALL" || contract.status === status;
      const matchesStation = station === "ALL" || contract.stations.includes(station);
      return matchesQuery && matchesStatus && matchesStation;
    });
  }, [data.contracts, query, station, status]);

  const activeContracts = data.contracts.filter((contract) => contract.status === "ACTIVE");
  const listedRates = contracts.reduce(
    (total, contract) => total + contract.serviceRates.length,
    0,
  );

  const exportRates = () => {
    downloadPortalCsv(
      `tarifario-elevant-${new Date().toISOString().slice(0, 10)}`,
      [
        "Contrato",
        "Descripción",
        "Estado",
        "Estaciones",
        "Vigente desde",
        "Vigente hasta",
        "Código de servicio",
        "Servicio",
        "Unidad",
        "Moneda",
        "Tarifa unitaria",
      ],
      contracts.flatMap((contract) =>
        contract.serviceRates.map((rate) => [
          contract.contractNumber,
          contract.title,
          contract.status,
          contract.stations.join(" · "),
          contract.validFrom,
          contract.validUntil,
          rate.serviceCode,
          rate.serviceName,
          UNIT_LABELS[rate.unit],
          rate.currency,
          rate.unitPrice,
        ]),
      ),
    );
  };

  return (
    <div className={styles.page}>
      <PortalPageHeader
        eyebrow="Acuerdos comerciales"
        title="Contratos y tarifarios"
        description="Consulta la vigencia, cobertura por estación y tarifas autorizadas de los servicios contratados con AVIAM."
        actions={
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={exportRates}
            disabled={listedRates === 0}
          >
            <FileIcon />
            Exportar tarifario CSV
          </button>
        }
      />

      <section className={styles.metricGrid} aria-label="Resumen de contratos">
        <article className={styles.metricCard}>
          <span>Contratos visibles</span>
          <strong>{data.contracts.length}</strong>
          <small>Dentro de tu alcance de aerolínea</small>
        </article>
        <article className={styles.metricCard}>
          <span>Contratos activos</span>
          <strong>{activeContracts.length}</strong>
          <small>Con vigencia comercial actual</small>
        </article>
        <article className={styles.metricCard}>
          <span>Estaciones cubiertas</span>
          <strong>{stations.length}</strong>
          <small>{stations.join(" · ") || "Sin estaciones"}</small>
        </article>
        <article className={styles.metricCard}>
          <span>Tarifas consultables</span>
          <strong>
            {data.contracts.reduce(
              (total, contract) => total + contract.serviceRates.length,
              0,
            )}
          </strong>
          <small>Precios unitarios del alcance contratado</small>
        </article>
      </section>

      <div className={styles.toolbar} role="search" aria-label="Filtrar contratos">
        <div className={styles.searchControl}>
          <SearchIcon />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar número, nombre o estación"
            aria-label="Buscar contratos"
          />
        </div>
        <div className={styles.selectControl}>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            aria-label="Filtrar por estado"
          >
            <option value="ALL">Todos los estados</option>
            <option value="ACTIVE">Activos</option>
            <option value="DRAFT">Borradores</option>
            <option value="EXPIRED">Vencidos</option>
          </select>
        </div>
        <div className={styles.selectControl}>
          <select
            value={station}
            onChange={(event) => setStation(event.target.value)}
            aria-label="Filtrar por estación"
          >
            <option value="ALL">Todas las estaciones</option>
            {stations.map((item) => (
              <option value={item} key={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className={styles.contractResultCount} role="status" aria-live="polite">
        {contracts.length} {contracts.length === 1 ? "contrato encontrado" : "contratos encontrados"}
        {listedRates > 0 ? ` · ${listedRates} tarifas en la vista` : ""}
      </p>

      {contracts.length === 0 ? (
        <Panel>
          <EmptyState
            title="No hay contratos con esos filtros"
            description="Prueba otra búsqueda, estación o estado para ampliar la consulta."
          />
        </Panel>
      ) : (
        <div className={styles.contractGrid}>
          {contracts.map((contract) => (
            <article className={styles.contractCard} key={contract.id}>
              <div className={styles.dataCardHeader}>
                <div>
                  <p className={styles.mono}>{contract.contractNumber}</p>
                  <h2>{contract.title}</h2>
                </div>
                <StatusBadge status={contract.status} />
              </div>

              <dl className={styles.definitionGrid}>
                <div>
                  <dt>Vigente desde</dt>
                  <dd>{formatDate(contract.validFrom)}</dd>
                </div>
                <div>
                  <dt>Vigente hasta</dt>
                  <dd>{formatDate(contract.validUntil)}</dd>
                </div>
                <div className={styles.contractWideDefinition}>
                  <dt>Estaciones cubiertas</dt>
                  <dd>
                    <span className={styles.contractStationList}>
                      {contract.stations.map((item) => (
                        <span key={item}>{item}</span>
                      ))}
                    </span>
                  </dd>
                </div>
              </dl>

              <div className={styles.contractRatesHeading}>
                <div>
                  <h3>Tarifario vigente</h3>
                  <p>{contract.serviceRates.length} servicios contratados</p>
                </div>
              </div>

              {contract.serviceRates.length === 0 ? (
                <p className={styles.muted}>El tarifario todavía no está publicado.</p>
              ) : (
                <div className={styles.tableWrap}>
                  <table className={`${styles.table} ${styles.contractRatesTable}`}>
                    <caption className={styles.visuallyHidden}>
                      Tarifas del contrato {contract.contractNumber}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Servicio</th>
                        <th scope="col">Unidad</th>
                        <th scope="col" className={styles.number}>Tarifa</th>
                      </tr>
                    </thead>
                    <tbody>
                      {contract.serviceRates.map((rate) => (
                        <tr key={`${contract.id}-${rate.serviceCode}`}>
                          <td className={styles.cellMain}>
                            <strong>{rate.serviceName}</strong>
                            <span>{rate.serviceCode}</span>
                          </td>
                          <td>{UNIT_LABELS[rate.unit]}</td>
                          <td className={styles.number}>
                            {formatMoney(rate.unitPrice, rate.currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <Provenance value={contract.provenance} />
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export default PortalContracts;
