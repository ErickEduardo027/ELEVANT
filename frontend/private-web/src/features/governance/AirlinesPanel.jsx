import { useMemo, useState } from 'react';
import ConfirmDialog from '../../components/ConfirmDialog';
import FileDropField from '../../components/FileDropField';
import PrivateMediaImage from '../../components/PrivateMediaImage';
import { uploadCommercialMedia } from '../../services/commercialGovernanceApi';

const blank = {
  sourceName: '', displayName: '', legalName: '', region: '', countryCode: '',
  iataCode: '', icaoCode: '', logoUrl: '', sourceUrl: '', verificationSourceUrl: '',
  isVerified: false, isPublished: false, version: null,
};

const REGISTRY = {
  Found: { label: 'Verificada en registro', tone: 'border-status-success/40 bg-status-success/10 text-status-success', icon: '✓' },
  Mismatch: { label: 'Datos distintos en registro', tone: 'border-status-warning/40 bg-status-warning/10 text-status-warning', icon: '!' },
  Defunct: { label: 'Ya no opera según el registro', tone: 'border-status-danger/40 bg-status-danger/10 text-status-danger', icon: '✕' },
  NotFound: { label: 'No existe en el registro', tone: 'border-status-danger/40 bg-status-danger/10 text-status-danger', icon: '✕' },
  Unavailable: { label: 'Registro no disponible', tone: 'border-black/15 bg-black/[.04] text-text-secondary-light', icon: '…' },
};

/** Green, amber or red seal of the last public-registry check (ADR-0023). */
export function RegistryBadge({ status, source, url }) {
  const meta = REGISTRY[status];
  if (!meta) return <span className="text-xs text-text-secondary-light">Sin verificar en registro</span>;
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${meta.tone}`}>
    <span aria-hidden="true">{meta.icon}</span>{meta.label}{source && <> · {url ? <a href={url} target="_blank" rel="noreferrer noopener" className="underline">{source}</a> : source}</>}
  </span>;
}

export default function AirlinesPanel({ airlines, onSave, onArchive, onEnrich, onCheckRegistry }) {
  const [checks, setChecks] = useState({});
  const [checking, setChecking] = useState(null);
  async function checkRegistry(airline) {
    setChecking(airline.id);
    try {
      const result = await onCheckRegistry(airline.id);
      setChecks(current => ({ ...current, [airline.id]: result.check }));
    } catch (error) {
      setChecks(current => ({ ...current, [airline.id]: { status: 'Unavailable', differences: [error.message] } }));
    } finally {
      setChecking(null);
    }
  }
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [logo, setLogo] = useState(null);
  const [uploadError, setUploadError] = useState('');
  const [pendingArchive, setPendingArchive] = useState(null);
  const visible = useMemo(() => airlines.filter((airline) =>
    (showArchived || airline.isPublished) &&
    `${airline.displayName} ${airline.sourceName} ${airline.iataCode ?? ''} ${airline.icaoCode ?? ''}`
      .toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())),
  [airlines, query, showArchived]);

  function edit(airline) {
    setLogo(null);
    setEditingId(airline.id);
    setForm({ ...airline, legalName: airline.legalName ?? '',
      countryCode: airline.countryCode ?? '', iataCode: airline.iataCode ?? '',
      icaoCode: airline.icaoCode ?? '', logoUrl: airline.logoUrl ?? '',
      verificationSourceUrl: airline.verificationSourceUrl ?? '' });
  }
  function clear() { setEditingId(null); setForm(blank); setLogo(null); }
  async function save(event) {
    event.preventDefault(); setBusy(true); setUploadError('');
    try {
      const uploadedLogo = logo ? await uploadCommercialMedia('airline-logo', logo) : null;
      const saved = await onSave(editingId, {
        ...form, sourceName: form.sourceName.trim(), displayName: form.displayName.trim(),
        legalName: form.legalName.trim() || null, region: form.region.trim(),
        countryCode: form.countryCode.trim().toUpperCase() || null,
        iataCode: form.iataCode.trim().toUpperCase() || null,
        icaoCode: form.icaoCode.trim().toUpperCase() || null,
        logoUrl: uploadedLogo?.url ?? (form.logoUrl.trim() || null), sourceUrl: form.sourceUrl.trim(),
        verificationSourceUrl: form.verificationSourceUrl.trim() || null,
      });
      if (saved) clear();
    } catch (error) { setUploadError(error.message); }
    finally { setBusy(false); }
  }
  const change = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  return <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)] xl:grid-cols-[minmax(0,1fr)_410px]">
    <section className="rounded-xl border border-black/5 bg-white p-5 dark:bg-surface-dark-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-lg font-bold">Aerolíneas</h2><p className="text-xs text-text-secondary-light">Las fichas publicadas aparecen en nuevas solicitudes.</p></div>
        <div className="flex items-center gap-3"><strong className="text-sm text-accent-600">{airlines.filter((item) => item.isPublished).length} publicadas</strong>{onEnrich && <button type="button" onClick={() => void onEnrich()} className="rounded-lg border px-3 py-2 text-xs font-semibold">Completar fichas AVIAM</button>}</div>
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <label className="text-xs font-semibold">Buscar<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nombre o código" className="mt-1 block rounded-lg border px-3 py-2 text-sm dark:bg-surface-dark" /></label>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /> Mostrar archivadas</label>
      </div>
      <div className="mt-5 space-y-3">{visible.map((airline) => <article key={airline.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-black/10 p-4 dark:border-white/10">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-accent-600/10 text-sm font-bold text-accent-600">{airline.logoUrl ? <PrivateMediaImage url={airline.logoUrl} alt={airline.logoUrl.includes('/reference-') ? `Referencia visual de ${airline.displayName}` : `Logo de ${airline.displayName}`} className="max-h-10 max-w-10 object-contain" /> : airline.displayName.slice(0, 2)}</div>
          <div className="min-w-0 [overflow-wrap:anywhere]"><strong>{airline.displayName}</strong><p className="text-xs text-text-secondary-light">{airline.legalName || 'Sin dato confirmado'} · {airline.region}</p><p className="text-xs text-text-secondary-light">{airline.isPublished ? 'Publicada' : 'Archivada'} · {airline.isVerified ? 'Verificada manualmente' : 'Sin verificación manual'} · {[airline.iataCode, airline.icaoCode].filter(Boolean).join(' / ') || 'sin códigos'}</p>
            <div className="mt-1"><RegistryBadge status={checks[airline.id]?.status === 'Unavailable' ? 'Unavailable' : airline.registryStatus} source={airline.registrySource} url={airline.registryEntityUrl} /></div>
            {checks[airline.id]?.differences?.length > 0 && <ul role="status" className="mt-1 list-disc pl-4 text-xs text-text-secondary-light">{checks[airline.id].differences.map(item => <li key={item}>{item}</li>)}</ul>}
          </div>
        </div>
        <div className="flex flex-wrap gap-3">{onCheckRegistry && <button type="button" disabled={checking === airline.id} onClick={() => void checkRegistry(airline)} className="text-xs font-semibold text-accent-600 disabled:opacity-50">{checking === airline.id ? 'Consultando…' : 'Verificar en registro'}</button>}<button type="button" aria-label={`Editar ${airline.displayName}`} onClick={() => edit(airline)} className="text-xs font-semibold text-accent-600">Editar</button>{airline.isPublished && <button type="button" onClick={() => setPendingArchive(airline)} className="text-xs font-semibold text-status-danger">Archivar</button>}</div>
      </article>)}{visible.length === 0 && <p className="rounded-xl bg-black/[.03] p-5 text-sm dark:bg-white/[.04]">No hay aerolíneas que coincidan con el filtro.</p>}</div>
    </section>
    <form onSubmit={save} className="h-fit rounded-xl border border-black/5 bg-white p-5 dark:bg-surface-dark-card">
      <h2 className="text-lg font-bold">{editingId ? 'Editar aerolínea' : 'Nueva aerolínea'}</h2>
      <p className="mt-1 text-xs text-text-secondary-light">Registre únicamente datos sustentados por la fuente indicada.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {[['sourceName', 'Nombre de origen', 160], ['displayName', 'Nombre visible', 160], ['legalName', 'Razón social', 200], ['region', 'Región', 64], ['countryCode', 'País ISO (2 letras)', 2], ['iataCode', 'Código IATA', 2], ['icaoCode', 'Código ICAO', 3], ['sourceUrl', 'Sitio o fuente oficial', 512], ['verificationSourceUrl', 'Fuente de verificación', 512]].map(([key, label, max]) =>
          <label key={key} className="text-xs font-semibold">{label}<input required={['sourceName', 'displayName', 'region', 'sourceUrl'].includes(key)} readOnly={key === 'sourceName' && !!editingId} maxLength={max} value={form[key]} onChange={(event) => change(key, event.target.value)} className="mt-1 block w-full rounded-lg border px-3 py-2 text-sm dark:bg-surface-dark" /></label>)}
      </div>
      <FileDropField label="Logo de la aerolínea" accept="image/png,image/jpeg,image/webp" file={logo} onFile={setLogo} currentUrl={form.logoUrl} hint="PNG, JPG o WebP. Máximo 8 MB. El logo seleccionado se carga al guardar." />
      {uploadError && <p role="alert" className="mt-2 text-sm text-status-danger">{uploadError}</p>}
      <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isVerified} onChange={(event) => change('isVerified', event.target.checked)} /> Datos verificados con la fuente indicada</label>
      <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isPublished} onChange={(event) => change('isPublished', event.target.checked)} /> Disponible para nuevas solicitudes</label>
      <p className="mt-1 text-xs text-text-secondary-light">Para publicarla hace falta un check verde en el registro público o la verificación manual con su fuente. Cambiar el nombre visible o los códigos anula el check.</p>
      <div className="mt-5 flex gap-2"><button disabled={busy} className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">{busy ? 'Guardando…' : 'Guardar aerolínea'}</button>{editingId && <button type="button" onClick={clear} className="rounded-lg border px-3 py-2 text-sm">Cancelar</button>}</div>
    </form>
    <ConfirmDialog open={Boolean(pendingArchive)} title="Archivar aerolínea" description={`¿Archivar ${pendingArchive?.displayName ?? ''}? Dejará de aparecer en nuevas solicitudes.`} confirmLabel="Archivar" onClose={() => setPendingArchive(null)} onConfirm={async () => { const target = pendingArchive; setPendingArchive(null); await onArchive(target.id, target.version); }} />
  </div>;
}
