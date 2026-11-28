'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from '../../../i18n/LanguageScope';
import OccDialog from '../../occ-ui/OccDialog';
import { httpsUrl } from '../core/attribution';
import { DATA_CREDITS, loadCredits } from '../core/credits';
import { mapMessages } from '../mapMessages';

// «Créditos y licencias» of an OCC map (PR M5), opened from the link at the end of the map's attribution
// (core/attribution.js: creditsLink; OccMap opens it). It lists the 3D models of the aircraft with their base model,
// authors, source, licence and changes, and links each folder's LICENSE, NOTICE.md and SOURCE.md; the public-domain text
// logos on the fins with their trademark notice; and the data and tiles the map credits, with the aircraft data's
// source while the map draws traffic. The models and logos come from two static files (core/credits.js), read when it
// first opens: a loading state, then the list or an error with «Reintentar». Drawn in a portal on the page's body, so
// the map (a layout container) does not hold the fixed dialog to its own box, inside a wrapper that carries the OCC
// scope (`data-department="occ"`, styles/occ.css): the body is outside the shell's scope, and without it every
// `*-occ-*` token, the light theme and the scoped focus ring would be undefined (review of 2026-11-28). OccDialog keeps
// the focus inside, closes with Esc and gives the focus back to the link.

const LINK = 'text-occ-accent underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 '
  + 'focus-visible:outline-offset-2 focus-visible:outline-occ-accent';
const SECTION_TITLE = 'text-sm font-semibold text-occ-text';
const MUTED = 'text-occ-muted';

function External({ href, children }) {
  const safe = httpsUrl(href);
  if (safe === null) return <>{children}</>;
  return <a href={safe} target="_blank" rel="noopener noreferrer" className={LINK}>{children}</a>;
}

const LOADING = Object.freeze({ status: 'loading', models: [], logos: [] });

function useCredits(open, loader) {
  const [state, setState] = useState(LOADING);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    loader().then(
      credits => { if (live) setState({ status: 'ready', models: credits.models, logos: credits.logos }); },
      () => { if (live) setState({ status: 'error', models: [], logos: [] }); },
    );
    return () => { live = false; };
  }, [open, loader, attempt]);
  // «Reintentar» says it is loading again; a dialog opened again after a failure tries again on its own.
  const retry = useCallback(() => {
    setState(LOADING);
    setAttempt(value => value + 1);
  }, []);
  return [state, retry];
}

function ModelCredit({ model, t }) {
  const titleId = useId();
  const short = model.commit.slice(0, 7);
  return (
    <li>
      <article aria-labelledby={titleId} className="border-t border-occ-line py-2">
        <h4 id={titleId} className="font-semibold text-occ-text">
          {model.icao} · {model.name}
        </h4>
        <dl className="mt-1 grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-3 gap-y-0.5">
          <dt className={MUTED}>{t('credits.models.base')}</dt>
          <dd>{model.proxy ? t('credits.models.proxy', { base: model.baseName }) : model.baseName}</dd>
          {model.authors !== '' && <>
            <dt className={MUTED}>{t('credits.models.authors')}</dt>
            <dd>{model.authors}</dd>
          </>}
          {model.repository !== '' && <>
            <dt className={MUTED}>{t('credits.models.source')}</dt>
            <dd>
              <External href={model.sourceUrl ?? model.repositoryUrl}>{model.repository}</External>
              {short !== '' && <span className={MUTED}> ({t('credits.models.commit', { commit: short })})</span>}
            </dd>
          </>}
          {model.upstream !== '' && <>
            <dt className={MUTED}>{t('credits.models.upstream')}</dt>
            <dd>
              <External href={model.upstreamUrl}>{model.upstream}</External>
              {model.note !== '' && <span className={`block ${MUTED}`}>{model.note}</span>}
            </dd>
          </>}
          <dt className={MUTED}>{t('credits.models.licence')}</dt>
          <dd>{model.licence}</dd>
        </dl>
        {model.changeDate !== '' && <p className="mt-1">{t('credits.models.modified', { date: model.changeDate })}</p>}
        {model.changes.length > 0 && (
          <details className="mt-1">
            <summary className={`cursor-pointer ${LINK}`}>{t('credits.models.changes', { icao: model.icao })}</summary>
            <ul className={`mt-1 list-disc space-y-0.5 pl-5 ${MUTED}`}>
              {model.changes.map(change => <li key={change}>{change}</li>)}
            </ul>
          </details>
        )}
        {model.notices.length > 0 && (
          <ul aria-label={t('credits.models.notices', { icao: model.icao })} className="mt-1 flex flex-wrap gap-x-3">
            {model.notices.map(notice => (
              <li key={notice.file}>
                <a href={notice.href} target="_blank" rel="noopener noreferrer" className={LINK}>{notice.file}</a>
              </li>
            ))}
          </ul>
        )}
      </article>
    </li>
  );
}

function Section({ title, children }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="mt-4 first:mt-0">
      <h3 id={id} className={SECTION_TITLE}>{title}</h3>
      {children}
    </section>
  );
}

/**
 * Props: `open`, `onClose()`, `aircraftSource` (`{ name, homeUrl, licenseName, licenseUrl }` of the traffic on screen,
 * else null) and `loader` (core/credits.js loadCredits by default).
 */
export default function MapCreditsDialog({ open, onClose, aircraftSource = null, loader = loadCredits }) {
  const { t } = useTranslation(mapMessages);
  const [credits, retry] = useCredits(open, loader);
  const introId = useId();
  if (!open || typeof document === 'undefined') return null;

  const status = credits.status === 'loading'
    ? <p role="status" className={`mt-2 ${MUTED}`}>{t('credits.loading')}</p>
    : null;
  const error = credits.status === 'error' ? (
    <div role="alert" className="mt-2 flex flex-wrap items-center gap-3">
      <p>{t('credits.error')}</p>
      <button type="button" onClick={retry}
        className="min-h-9 rounded border border-occ-line bg-occ-panel px-3 text-sm font-semibold text-occ-text hover:bg-occ-panel-raised">
        {t('credits.retry')}
      </button>
    </div>
  ) : null;
  const ready = credits.status === 'ready';

  return createPortal(
    <div data-department="occ" data-occ-map-credits-scope="">
      <OccDialog open onClose={onClose} title={t('credits.title')} size="lg" descriptionId={introId}
        data-testid="occ-map-credits">
        <p id={introId} className={MUTED}>{t('credits.intro')}</p>
        <div className="mt-4">
          <Section title={t('credits.models.title')}>
            <p className={`mt-1 ${MUTED}`}>{t('credits.models.intro')}</p>
            {status}
            {error}
            {ready && (credits.models.length === 0
              ? <p className="mt-2">{t('credits.models.empty')}</p>
              : <ul className="mt-2">{credits.models.map(model => <ModelCredit key={model.icao} model={model} t={t} />)}</ul>)}
          </Section>
          <Section title={t('credits.logos.title')}>
            <p className={`mt-1 ${MUTED}`}>{t('credits.logos.intro')}</p>
            {ready && (credits.logos.length === 0
              ? <p className="mt-2">{t('credits.logos.empty')}</p>
              : (
                <ul className="mt-2 space-y-0.5">
                  {credits.logos.map(logo => (
                    <li key={logo.iata}>
                      {logo.airline} ({logo.iata}) · <External href={logo.page}>{t('credits.logos.commons')}</External>
                      {logo.tag !== '' && <span className={MUTED}> · {logo.tag}{logo.trademarked ? ` · ${t('credits.logos.trademarked')}` : ''}</span>}
                    </li>
                  ))}
                </ul>
              ))}
            <p className={`mt-1 ${MUTED}`}>{t('credits.logos.noLogo')}</p>
          </Section>
          <Section title={t('credits.data.title')}>
            <dl className="mt-1 grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-3 gap-y-0.5">
              {DATA_CREDITS.map(entry => (
                <div key={entry.key} className="contents">
                  <dt className={MUTED}>{t(`credits.data.${entry.key}`)}</dt>
                  <dd>
                    {entry.links.map((link, index) => (
                      <span key={`${link.href}-${link.text}`}>
                        {index > 0 && ' · '}
                        <External href={link.href}>{link.text}</External>
                      </span>
                    ))}
                  </dd>
                </div>
              ))}
              <div className="contents">
                <dt className={MUTED}>{t('credits.data.aircraft')}</dt>
                <dd>
                  {aircraftSource?.name ? <>
                    <External href={aircraftSource.homeUrl}>{aircraftSource.name}</External>
                    {aircraftSource.licenseName
                      ? <> (<External href={aircraftSource.licenseUrl}>{aircraftSource.licenseName}</External>)</>
                      : null}
                  </> : <span className={MUTED}>{t('credits.data.aircraftNone')}</span>}
                </dd>
              </div>
            </dl>
          </Section>
        </div>
      </OccDialog>
    </div>,
    document.body,
  );
}
