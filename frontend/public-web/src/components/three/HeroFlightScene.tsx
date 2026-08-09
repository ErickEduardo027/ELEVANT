"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import type { GraphicTier } from "@/lib/graphics";

import styles from "./HeroFlightScene.module.css";

type HeroFlightEngineInstance =
  import("./heroFlightEngine").HeroFlightEngine;

type RenderState = "poster" | "loading" | "ready" | "unavailable";

export type HeroFlightSceneProps = {
  /** Optional controlled progress from 0 to 1. Natural page scroll is used otherwise. */
  progress?: number;
  className?: string;
  ariaLabel?: string;
  onTierChange?: (tier: GraphicTier) => void;
};

const DEFAULT_ARIA_LABEL =
  "Vuelo de Miami a Punta Cana sobre un globo terrestre. La ruta se convierte en cinco hitos: planificar, ejecutar, evidenciar, validar y consultar.";
const FORCED_GRAPHICS_TIER: Exclude<GraphicTier, "STATIC"> = "FULL";

function clampProgress(value: number) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function getScrollProgress(element: HTMLElement) {
  const bounds = element.getBoundingClientRect();
  const viewportHeight = Math.max(1, window.innerHeight);
  const travelDistance = Math.max(bounds.height * 0.9, viewportHeight * 0.82);
  return clampProgress(-bounds.top / travelDistance);
}

function HeroFlightPoster({
  accessible,
  ariaLabel,
}: {
  accessible: boolean;
  ariaLabel: string;
}) {
  return (
    <div
      className={styles.poster}
      role={accessible ? "img" : undefined}
      aria-label={accessible ? ariaLabel : undefined}
      aria-hidden={accessible ? undefined : true}
    >
      <div className={styles.posterGlow} />
      <div className={styles.posterGlobe}>
        <div className={styles.posterAtmosphere} />
        <svg
          className={styles.posterRoute}
          viewBox="0 0 800 560"
          preserveAspectRatio="xMidYMid meet"
          focusable="false"
        >
          <path
            className={styles.posterRouteShadow}
            d="M 126 404 C 238 154, 542 108, 682 224"
          />
          <path
            className={styles.posterRouteLine}
            d="M 126 404 C 238 154, 542 108, 682 224"
          />
          {[0, 1, 2, 3, 4].map((node) => (
            <circle
              className={styles.posterNode}
              key={node}
              cx={[126, 245, 380, 532, 682][node]}
              cy={[404, 226, 158, 157, 224][node]}
              r={node === 4 ? 8 : 5}
            />
          ))}
          <g className={styles.posterPlane} transform="translate(516 156) rotate(10)">
            <path d="M-28-7 0-3 18-29l9 2-9 31 29 10v8L17 18 4 44l-9-1 3-29-27-10Z" />
          </g>
        </svg>
        <div className={styles.posterSheen} />
      </div>
    </div>
  );
}

export function HeroFlightScene({
  progress,
  className,
  ariaLabel = DEFAULT_ARIA_LABEL,
  onTierChange,
}: HeroFlightSceneProps) {
  const sceneRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<HeroFlightEngineInstance | null>(null);
  const progressRef = useRef<number | undefined>(progress);
  const onTierChangeRef = useRef(onTierChange);
  const tier = FORCED_GRAPHICS_TIER;
  const [renderState, setRenderState] = useState<RenderState>("poster");
  const [webGLFailed, setWebGLFailed] = useState(false);

  useEffect(() => {
    progressRef.current = progress;
    const scene = sceneRef.current;
    const engine = engineRef.current;
    if (!scene) return;

    const nextProgress =
      typeof progress === "number"
        ? clampProgress(progress)
        : getScrollProgress(scene);
    scene.style.setProperty("--flight-progress", String(nextProgress));
    engine?.setProgress(nextProgress);
  }, [progress]);

  useEffect(() => {
    onTierChangeRef.current = onTierChange;
  }, [onTierChange]);

  useEffect(() => {
    onTierChangeRef.current?.(tier);
  }, [tier]);

  useEffect(() => {
    const scene = sceneRef.current;
    const canvasHost = canvasHostRef.current;
    if (!scene || !canvasHost || webGLFailed) {
      engineRef.current = null;
      setRenderState(webGLFailed ? "unavailable" : "poster");
      return;
    }

    let cancelled = false;
    let engine: HeroFlightEngineInstance | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let intersectionObserver: IntersectionObserver | null = null;
    let scrollFrame = 0;
    let isIntersecting = false;

    const updateActivity = () => {
      engine?.setActive(
        isIntersecting && document.visibilityState === "visible",
      );
    };

    const updateProgress = () => {
      const nextProgress =
        typeof progressRef.current === "number"
          ? clampProgress(progressRef.current)
          : getScrollProgress(scene);
      scene.style.setProperty("--flight-progress", String(nextProgress));
      engine?.setProgress(nextProgress);
    };

    const queueProgressUpdate = () => {
      if (!isIntersecting) return;
      window.cancelAnimationFrame(scrollFrame);
      scrollFrame = window.requestAnimationFrame(updateProgress);
    };

    const handleVisibility = () => updateActivity();

    const failToPoster = () => {
      if (cancelled) return;
      setRenderState("unavailable");
      setWebGLFailed(true);
    };

    setRenderState("loading");

    void import("./heroFlightEngine")
      .then(({ HeroFlightEngine }) => {
        if (cancelled) return;

        engine = new HeroFlightEngine({
          tier,
          onContextLost: failToPoster,
        });
        engineRef.current = engine;
        engine.canvas.className = styles.canvas;
        engine.canvas.setAttribute("role", "img");
        engine.canvas.setAttribute("aria-label", ariaLabel);
        canvasHost.appendChild(engine.canvas);

        resizeObserver = new ResizeObserver(([entry]) => {
          if (!entry) return;
          engine?.resize(entry.contentRect.width, entry.contentRect.height);
        });
        resizeObserver.observe(canvasHost);
        engine.resize(canvasHost.clientWidth, canvasHost.clientHeight);

        intersectionObserver = new IntersectionObserver(
          ([entry]) => {
            isIntersecting = Boolean(entry?.isIntersecting);
            if (isIntersecting) updateProgress();
            updateActivity();
          },
          { rootMargin: "120px 0px", threshold: 0.01 },
        );
        intersectionObserver.observe(scene);

        document.addEventListener("visibilitychange", handleVisibility);
        window.addEventListener("scroll", queueProgressUpdate, {
          passive: true,
        });
        updateProgress();
        engine.renderOnce();
        setRenderState("ready");
      })
      .catch(() => {
        failToPoster();
      });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(scrollFrame);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("scroll", queueProgressUpdate);
      intersectionObserver?.disconnect();
      resizeObserver?.disconnect();
      engine?.dispose();
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, [ariaLabel, tier, webGLFailed]);

  const posterIsAccessible =
    renderState === "poster" || renderState === "unavailable";
  const sceneStyle = {
    "--flight-progress": "0",
  } as CSSProperties;

  return (
    <div
      ref={sceneRef}
      className={[styles.scene, className].filter(Boolean).join(" ")}
      data-graphics-tier={tier}
      data-render-state={renderState}
      style={sceneStyle}
    >
      <HeroFlightPoster
        accessible={posterIsAccessible}
        ariaLabel={ariaLabel}
      />
      <div ref={canvasHostRef} className={styles.canvasHost} />
      <div className={styles.readabilityScrim} aria-hidden="true" />
      <div className={styles.telemetry} aria-hidden="true">
        <span className={styles.telemetryStatus}>
          <i /> Ruta operacional
        </span>
        <strong>
          MIA <span>→</span> PUJ
        </strong>
        <small>18.567° N · 68.363° O</small>
      </div>
      <div className={styles.tierBadge} aria-hidden="true">
        {renderState === "unavailable"
          ? "RESPALDO VISUAL"
          : `MOTOR 3D · ${tier}`}
      </div>
    </div>
  );
}

export default HeroFlightScene;
