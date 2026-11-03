"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./SignaturePad.module.css";

const WIDTH = 600;
const HEIGHT = 200;

/**
 * Drawn signature (ADR-0025): pointer and touch strokes on a canvas, exported as a PNG data URL
 * (600×200, well below the API limits). `onChange` receives null while the pad is empty.
 */
export function SignaturePad({ id, label, onChange }: {
  id: string; label: string; onChange: (png: string | null) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  const context = useCallback(() => {
    const element = canvas.current;
    const ctx = element?.getContext("2d");
    if (!element || !ctx) return null;
    ctx.lineWidth = 2.6;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#081b3a";
    return { element, ctx };
  }, []);

  useEffect(() => { context()?.ctx.clearRect(0, 0, WIDTH, HEIGHT); }, [context]);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - box.left) * (WIDTH / box.width), y: (event.clientY - box.top) * (HEIGHT / box.height) };
  };

  const start = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const target = context();
    if (!target) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drawing.current = true;
    const { x, y } = point(event);
    target.ctx.beginPath();
    target.ctx.moveTo(x, y);
    target.ctx.lineTo(x + 0.1, y + 0.1);
    target.ctx.stroke();
  };

  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const target = context();
    if (!target) return;
    const { x, y } = point(event);
    target.ctx.lineTo(x, y);
    target.ctx.stroke();
  };

  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    const element = canvas.current;
    if (!element) return;
    setEmpty(false);
    onChange(element.toDataURL("image/png"));
  };

  const clear = () => {
    context()?.ctx.clearRect(0, 0, WIDTH, HEIGHT);
    setEmpty(true);
    onChange(null);
  };

  return <div className={styles.pad}>
    <span id={`${id}-label`} className={styles.label}>{label}</span>
    <canvas id={id} ref={canvas} width={WIDTH} height={HEIGHT} className={styles.canvas} role="img"
      aria-labelledby={`${id}-label`} aria-describedby={`${id}-hint`}
      onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end} onPointerCancel={end} />
    <div className={styles.footer}>
      <span id={`${id}-hint`} className={styles.hint}>
        {empty ? "Firme dentro del recuadro con el ratón, el lápiz o el dedo." : "Firma registrada."}
      </span>
      <button type="button" className={styles.clear} onClick={clear} disabled={empty}>Borrar firma</button>
    </div>
  </div>;
}
