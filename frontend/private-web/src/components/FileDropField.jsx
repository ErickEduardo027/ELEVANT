import { useEffect, useRef, useState } from 'react';
import { usePrivateMediaUrl } from '../hooks/usePrivateMediaUrl';

export default function FileDropField({ label, accept, file, onFile, hint, currentUrl, kind = 'image' }) {
  const input = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState(null);
  const resolvedCurrentUrl = usePrivateMediaUrl(currentUrl);
  const [error, setError] = useState('');
  const allowedTypes = accept.split(',').map(type => type.trim());
  function choose(candidate) {
    if (!candidate) return;
    const limit = kind === 'video' ? 24 * 1024 * 1024 : 8 * 1024 * 1024;
    if (!allowedTypes.includes(candidate.type) || candidate.size < 1 || candidate.size > limit) {
      setError(`Seleccione un archivo ${allowedTypes.join(', ')} de hasta ${kind === 'video' ? '24' : '8'} MB.`);
      return;
    }
    setError('');
    onFile(candidate);
  }
  useEffect(() => {
    if (!file) { setPreview(null); return undefined; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const selected = preview ?? resolvedCurrentUrl;
  return <div className="mt-4">
    <span className="text-xs font-semibold">{label}</span>
    <div role="button" tabIndex={0} aria-label={`Seleccionar ${label.toLowerCase()}`} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); input.current?.click(); } }} onClick={() => input.current?.click()}
      onDragEnter={event => { event.preventDefault(); setDragging(true); }} onDragOver={event => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); choose(event.dataTransfer.files[0]); }}
      className={`mt-2 flex min-h-36 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed p-4 text-center text-xs transition-colors ${dragging ? 'border-accent-600 bg-accent-600/10' : 'border-black/15 hover:border-accent-600 dark:border-white/20'}`}>
      {selected && kind === 'image' ? <img src={selected} alt={`Vista previa de ${label.toLowerCase()}`} className="max-h-32 max-w-full object-contain" /> : null}
      {selected && kind === 'video' ? <video src={selected} controls onClick={event => event.stopPropagation()} className="max-h-32 max-w-full" /> : null}
      <span className="mt-2">{file?.name ?? 'Arrastre el archivo aquí o pulse para buscarlo'}</span>
    </div>
    <input ref={input} type="file" accept={accept} aria-label={label} className="sr-only" onChange={event => { choose(event.target.files?.[0]); event.target.value = ''; }} />
    {hint && <p className="mt-1 text-xs text-text-secondary-light">{hint}</p>}
    {error && <p role="alert" className="mt-1 text-xs text-status-danger">{error}</p>}
  </div>;
}
