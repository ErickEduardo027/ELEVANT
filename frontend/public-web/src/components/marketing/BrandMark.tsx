import Link from "next/link";

type BrandMarkProps = {
  href?: string;
  compact?: boolean;
};

export function BrandMark({ href = "/", compact = false }: BrandMarkProps) {
  return (
    <Link
      className={`brand-mark${compact ? " brand-mark--compact" : ""}`}
      href={href}
      aria-label="ELEVANT, ir al inicio"
    >
      <span className="brand-mark__symbol" aria-hidden="true">
        <svg
          className="brand-mark__emblem"
          viewBox="0 0 64 56"
          focusable="false"
        >
          <path
            className="brand-mark__emblem-blue"
            d="M15 3h44l-5.2 10.8c-1.2 2.5-3.7 4.2-6.5 4.2H7.8l5.1-11.2A6 6 0 0 1 15 3Z"
          />
          <path
            className="brand-mark__emblem-blue"
            d="M10.5 21h42.8l-4.8 10.2a7.7 7.7 0 0 1-7 4.4H3.2l5-10.9a6.9 6.9 0 0 1 2.3-3.7Z"
          />
          <path
            className="brand-mark__aircraft"
            d="m17.5 31.3 11.8-3.6-3.2-3.6 2.7-.8 7.2 2.6 10-3 .9 1.5-7.6 5.2-7.6 2.3-4.4 2.4-2.1-.1 1.5-3.4-3.8-1.2-5.5 1.2-2.4-.8 2.6-2.9Z"
          />
          <path
            className="brand-mark__emblem-orange"
            d="M6 39h39.2l-4.5 9.7a7.5 7.5 0 0 1-6.8 4.3H0l4.2-10.4A7 7 0 0 1 6 39Z"
          />
        </svg>
      </span>
      <span className="brand-mark__word">
        ELEV<span>A</span>NT
      </span>
      {!compact && (
        <span className="brand-mark__descriptor">Operaciones en tierra</span>
      )}
    </Link>
  );
}
