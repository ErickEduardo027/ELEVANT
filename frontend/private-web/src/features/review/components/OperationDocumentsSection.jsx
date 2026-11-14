import { useEffect, useState } from 'react';
import { abortForEffectCleanup, isAbortError } from '../../../lib/abort';
import { useTranslation } from '../../../i18n/LanguageScope';
import { formatPlanningClock } from '../../planning/planningTime';
import OccButton from '../../occ-ui/OccButton';
import OccGlyph from '../../occ-ui/OccGlyph';
import OccPanel from '../../occ-ui/OccPanel';
import {
  downloadOccOperationDocument,
  getOccDamagePhoto,
  getOccOperationDocuments,
} from '../../../services/occDocumentsService';
import { reviewMessages } from '../reviewMessages';

/**
 * The photo of one walk-around damage (3-K), read only when OCC opens it: loading, the photo, a recoverable error
 * with «Reintentar», and the unauthorized state without it. The object URL is released when the photo closes.
 */
function DamagePhoto({ operationId, markId }) {
  const { t } = useTranslation(reviewMessages);
  const [state, setState] = useState({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let url = null;
    getOccDamagePhoto(operationId, markId, { signal: controller.signal })
      .then(blob => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setState({ status: 'success', url });
      })
      .catch(error => { if (!isAbortError(error)) setState({ status: 'error', error }); });
    return () => {
      abortForEffectCleanup(controller);
      if (url) URL.revokeObjectURL(url);
    };
  }, [operationId, markId, attempt]);

  if (state.status === 'loading') return <p className="text-sm text-occ-muted" role="status">{t('documents.photoLoading')}</p>;
  if (state.status === 'error') {
    return (
      <div role="alert" className="space-y-2 text-sm text-occ-text">
        <p>{state.error.message}</p>
        {state.error.status !== 403 && (
          <OccButton size="sm" onClick={() => { setState({ status: 'loading' }); setAttempt(value => value + 1); }}>
            {t('retry')}
          </OccButton>
        )}
      </div>
    );
  }
  // A blob: URL of bytes read with OCC's session: next/image cannot fetch nor optimize it.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={state.url} alt={t('documents.photoAlt')} className="max-h-64 w-auto rounded border border-occ-line" />;
}

/** The damages marked on the silhouette, with their note, the station's local time and the photo on demand. */
function DamageMarks({ operationId, marks, timeZone }) {
  const { t } = useTranslation(reviewMessages);
  const [open, setOpen] = useState(null);
  if (marks.length === 0) return null;
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold text-occ-text">{t('documents.marks')}</h4>
      <ul className="space-y-2">
        {marks.map(mark => (
          <li key={mark.id} className="space-y-2 rounded border border-occ-line p-2 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0"><span className="font-mono font-semibold">{formatPlanningClock(mark.reportedAt, timeZone)}</span> · {mark.note}</p>
              {mark.hasPhoto ? (
                <OccButton size="sm" aria-expanded={open === mark.id}
                  onClick={() => setOpen(current => (current === mark.id ? null : mark.id))}>
                  {open === mark.id ? t('documents.hidePhoto') : t('documents.showPhoto')}
                </OccButton>
              ) : <span className="text-occ-muted">{t('documents.noPhoto')}</span>}
            </div>
            {open === mark.id && <DamagePhoto operationId={operationId} markId={mark.id} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Who signed a form's role, who must sign it again (its content changed after the signature) and who is pending. */
function SignatureState({ signature, stale }) {
  const { t } = useTranslation(reviewMessages);
  if (signature) return <span className="font-semibold text-occ-text">{t('documents.signed', { name: signature.signerName })}</span>;
  if (stale) {
    return (
      <span className="inline-flex items-center gap-1.5 text-occ-text">
        <OccGlyph name="attention" />
        <span>{t('documents.signAgain')}</span>
      </span>
    );
  }
  return <span className="text-occ-muted">{t('documents.pending')}</span>;
}

/**
 * «Formularios AVIAM» in the OCC review (ADR-0032): the forms generated from what the agent
 * captured, who already signed each one, the PDF exactly as the airline receives it, and the damages of the
 * walk-around with their photo (3-K) in the station's local time. Its panel keeps the region «Formularios AVIAM».
 */
export default function OperationDocumentsSection({ operationId, timeZone }) {
  const { t, language } = useTranslation(reviewMessages);
  const [state, setState] = useState({ status: 'loading' });
  const [downloading, setDownloading] = useState(null);
  const [downloadError, setDownloadError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    getOccOperationDocuments(operationId, { signal: controller.signal })
      .then(data => setState({ status: data.documents.length ? 'success' : 'empty', data }))
      .catch(error => { if (!isAbortError(error)) setState({ status: 'error', error }); });
    return () => abortForEffectCleanup(controller);
  }, [operationId, attempt]);

  async function download(document) {
    setDownloading(document.kind);
    setDownloadError(null);
    try {
      await downloadOccOperationDocument(operationId, document);
    } catch (error) {
      setDownloadError(error.message);
    } finally {
      setDownloading(null);
    }
  }

  const { titles, roles } = (reviewMessages[language] ?? reviewMessages.es).documents;
  const meta = state.status === 'success' ? t('close.damages', { count: state.data.damageMarks.length }) : null;

  return (
    <OccPanel headingLevel={3} title={t('documents.title')} meta={meta}>
      <div className="space-y-3 p-3 text-sm">
        {state.status === 'loading' && <p className="text-occ-muted" role="status">{t('documents.loading')}</p>}
        {state.status === 'empty' && <p className="text-occ-muted">{t('documents.empty')}</p>}
        {state.status === 'error' && (
          <div role="alert" className="space-y-2 text-occ-text">
            <p>{state.error.message}</p>
            {state.error.status !== 403 && (
              <OccButton size="sm" onClick={() => { setState({ status: 'loading' }); setAttempt(value => value + 1); }}>
                {t('retry')}
              </OccButton>
            )}
          </div>
        )}
        {state.status === 'success' && (
          // Side by side while the detail has the width of the page (below 1280 px); docked, one under the other.
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-1">
            {state.data.documents.map(document => (
              <li key={document.kind} className="flex min-w-0 flex-col gap-2 rounded border border-occ-line p-3">
                <div className="min-w-0">
                  <p className="font-semibold text-occ-text">{titles[document.kind] ?? document.title}</p>
                  <p className="font-mono text-xs text-occ-muted">{document.number} · {document.formCode}</p>
                </div>
                <ul className="space-y-1">
                  {document.requiredRoles.map(role => (
                    <li key={role} className="flex justify-between gap-2">
                      <span className="min-w-0 text-occ-muted">{roles[role] ?? role}</span>
                      <SignatureState signature={document.signatures.find(item => item.role === role)}
                        stale={document.staleRoles.includes(role)} />
                    </li>
                  ))}
                </ul>
                <p className="break-all font-mono text-xs text-occ-muted" title={t('documents.fingerprint')}>
                  {document.contentSha256.slice(0, 16)}…
                </p>
                <OccButton size="sm" className="mt-auto self-start" busy={downloading === document.kind}
                  busyLabel={t('documents.generating')} disabled={downloading !== null}
                  onClick={() => void download(document)}>
                  {t('documents.download')}
                </OccButton>
              </li>
            ))}
          </ul>
        )}
        {downloadError && <p role="alert" className="text-occ-text">{downloadError}</p>}
        {state.status === 'success' && (
          <DamageMarks operationId={operationId} marks={state.data.damageMarks} timeZone={timeZone} />
        )}
      </div>
    </OccPanel>
  );
}
