import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function IconFrame({ children, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      focusable="false"
      viewBox="0 0 24 24"
      {...props}
    >
      {children}
    </svg>
  );
}

export function HomeIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="m3.5 10.5 8.5-7 8.5 7v9a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-9Z" />
      <path d="M9 20.5v-6h6v6" />
    </IconFrame>
  );
}

export function PlaneIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="m21 16-8.5-2.5V20L10 21l-2.5-8L3 11V9.5l4.5.5L10 2l2.5 1.5V10L21 7.5V16Z" />
    </IconFrame>
  );
}

export function ClipboardIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M9 5H6.5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H15" />
      <path d="M9 3h6v4H9zM8 12h8M8 16h5" />
    </IconFrame>
  );
}

export function FileIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M6 2.5h8l4 4v15H6z" />
      <path d="M14 2.5v5h4M9 12h6M9 16h6" />
    </IconFrame>
  );
}

export function FinanceIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M5 3.5h14v17H5zM8 8h8M8 12h3M8 16h3M14 12h2M14 16h2" />
    </IconFrame>
  );
}

export function ChartIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M4 20V4M4 20h16M8 16v-4M12 16V7M16 16v-6M20 16V5" />
    </IconFrame>
  );
}

export function UserIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
    </IconFrame>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </IconFrame>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="m5 5 14 14M19 5 5 19" />
    </IconFrame>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 5 5" />
    </IconFrame>
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M20 7v5h-5M4 17v-5h5" />
      <path d="M18.2 9A7 7 0 0 0 6.5 6.5L4 9M5.8 15A7 7 0 0 0 17.5 17.5L20 15" />
    </IconFrame>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M4 12h16M14 6l6 6-6 6" />
    </IconFrame>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="m15 5-7 7 7 7" />
    </IconFrame>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </IconFrame>
  );
}

export function DatabaseIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </IconFrame>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M12 3 2.8 20h18.4L12 3Z" />
      <path d="M12 9v5M12 17.5v.1" />
    </IconFrame>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="m4 12.5 5 5L20 6.5" />
    </IconFrame>
  );
}

export function ExternalLinkIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M14 4h6v6M20 4l-9 9" />
      <path d="M18 13v7H4V6h7" />
    </IconFrame>
  );
}

export function MoreIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
    </IconFrame>
  );
}
