import { useCallback, useEffect, useRef, useState } from 'react';

const WIDTH = 600;
const HEIGHT = 200;

/**
 * Drawn signature (ADR-0025): pointer and touch strokes on a canvas, exported as a PNG data URL
 * (600×200, within the API limits). `onChange` receives null while the pad is empty.
 */
export default function SignaturePad({ id, label = 'Firma', onChange }) {
  const canvas = useRef(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  const context = useCallback(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return null;
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#081b3a';
    return ctx;
  }, []);

  useEffect(() => { context()?.clearRect(0, 0, WIDTH, HEIGHT); }, [context]);

  function point(event) {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - box.left) * (WIDTH / (box.width || WIDTH)), y: (event.clientY - box.top) * (HEIGHT / (box.height || HEIGHT)) };
  }

  function start(event) {
    const ctx = context();
    if (!ctx) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drawing.current = true;
    const { x, y } = point(event);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 0.1, y + 0.1);
    ctx.stroke();
  }

  function move(event) {
    if (!drawing.current) return;
    const ctx = context();
    if (!ctx) return;
    const { x, y } = point(event);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    setEmpty(false);
    onChange?.(canvas.current.toDataURL('image/png'));
  }

  function clear() {
    context()?.clearRect(0, 0, WIDTH, HEIGHT);
    setEmpty(true);
    onChange?.(null);
  }

  return (
    <div className="grid gap-1">
      <span id={`${id}-label`} className="font-medium">{label}</span>
      <canvas id={id} ref={canvas} width={WIDTH} height={HEIGHT} role="img" aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-hint`}
        className="aspect-[3/1] h-auto w-full max-w-[600px] cursor-crosshair touch-none rounded-lg border-2 border-dashed border-black/20 bg-white dark:border-white/20"
        onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end} onPointerCancel={end} />
      <div className="flex max-w-[600px] flex-wrap items-center justify-between gap-2">
        <span id={`${id}-hint`} className="text-xs text-text-secondary-light">
          {empty ? 'Firma dentro del recuadro con el ratón, el lápiz o el dedo.' : 'Firma registrada.'}
        </span>
        <button type="button" onClick={clear} disabled={empty}
          className="rounded-lg border border-black/15 px-3 py-1 text-xs font-semibold disabled:opacity-50 dark:border-white/15">
          Borrar firma
        </button>
      </div>
    </div>
  );
}
