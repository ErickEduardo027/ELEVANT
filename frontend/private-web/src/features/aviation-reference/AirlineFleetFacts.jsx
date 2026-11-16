'use client';

import { useState } from 'react';
import { useTranslation } from '../../i18n/LanguageScope';
import { useAviationReferenceRead, useAviationReferenceService } from './AviationReferenceContext';
import { fleetSummary, hasNoFleet, statusWords } from './aviationReferenceFormat';
import { aviationReferenceMessages } from './aviationReferenceMessages';

// The fleet of an airline according to AeroDataBox (ADR-0028, note of 15 November 2026), for Contratos' request intake
// and the superadministrator's airline catalog: «Flota según AeroDataBox: 87 aviones · A320, B738…» or «Sin flota
// registrada» as a warning. It informs the reviewer and blocks nothing: no approval reads it. The ICAO code is asked
// (IATA when there is none). `auto` reads as soon as it mounts (one request in review); without it a «Consultar flota»
// button reads on demand, so a list of airlines never spends units by being shown. Without an AviationReferenceProvider
// it renders nothing.

const TYPES_SHOWN = 6;

export default function AirlineFleetFacts({ icaoCode = null, iataCode = null, auto = false, className = '' }) {
  const service = useAviationReferenceService();
  const { t } = useTranslation(aviationReferenceMessages);
  const code = (typeof icaoCode === 'string' && icaoCode.trim()) || (typeof iataCode === 'string' && iataCode.trim()) || null;
  const [asked, setAsked] = useState(false);
  const key = service && code && (auto || asked) ? code.toUpperCase() : null;
  const read = useAviationReferenceRead(key, ({ signal }) => service.getAirlineFleet({ airlineCode: key, signal }));
  if (!service) return null;
  if (!code) return <p data-airline-fleet="no-code" className={`text-xs text-text-secondary-light ${className}`.trim()}>{t('fleet.noCode')}</p>;
  if (!key) {
    return (
      <button type="button" data-airline-fleet="ask" onClick={() => setAsked(true)}
        className={`text-xs font-semibold text-accent-600 ${className}`.trim()}>{t('fleet.check')}</button>
    );
  }

  const fleet = read.data;
  const summary = fleetSummary(t, fleet);
  const none = read.status === 'success' && hasNoFleet(fleet);
  const status = none ? null : statusWords(t, read, summary !== null);
  const types = (fleet?.types ?? []).slice(0, TYPES_SHOWN);
  return (
    <div data-airline-fleet={none ? 'none' : summary ? 'fleet' : read.status} aria-live="polite"
      className={`text-xs ${className}`.trim()}>
      {summary && <p className="font-semibold">{summary}</p>}
      {summary && types.length > 0 && (
        <p className="text-text-secondary-light">
          {t('fleet.sample', { count: fleet.sampledAircraft })}
          {': '}
          {types.map(type => `${type.model} (${type.count})`).join(' · ')}
        </p>
      )}
      {none && (
        <p className="rounded-md border border-status-warning/40 bg-status-warning/10 px-2 py-1 text-status-warning">
          <strong>{t('fleet.none')}</strong>
          {'. '}
          {t('fleet.noneHint')}
        </p>
      )}
      {status && <p className="text-text-secondary-light">{status}</p>}
      {summary && <p className="text-[11px] text-text-secondary-light">{t('source')}</p>}
    </div>
  );
}
