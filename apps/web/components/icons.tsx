// The design's inline icons: 24×24, round caps, currentColor unless told otherwise.

type P = { size?: number; color?: string; className?: string };

const svg = (
  size: number,
  color: string,
  width: number,
  children: React.ReactNode,
  className?: string,
) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth={width}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={className}
  >
    {children}
  </svg>
);

/** The crash-test target. */
export function Mark({ size = 24, stroke = 1.5 }: { size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10.75" fill="none" stroke="#F2C12E" strokeWidth={stroke} />
      <path d="M12 12 L12 3.5 A8.5 8.5 0 0 1 20.5 12 Z" fill="#F2C12E" />
      <path d="M12 12 L12 20.5 A8.5 8.5 0 0 1 3.5 12 Z" fill="#F2C12E" />
    </svg>
  );
}

export const Check = ({ size = 16, color = 'currentColor', className }: P) =>
  svg(size, color, 2.2, <path d="M5 12l5 5L20 7" />, className);

export const Cross = ({ size = 16, color = 'currentColor', className }: P) =>
  svg(size, color, 2.2, <path d="M18 6L6 18M6 6l12 12" />, className);

export const External = ({ size = 14, color = 'currentColor', className }: P) =>
  svg(
    size,
    color,
    2,
    <>
      <path d="M7 17L17 7" />
      <path d="M8 7h9v9" />
    </>,
    className,
  );

export const Copy = ({ size = 15, color = 'currentColor', className }: P) =>
  svg(
    size,
    color,
    2,
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </>,
    className,
  );

export const Replay = ({ size = 15, color = 'currentColor', className }: P) =>
  svg(
    size,
    color,
    2,
    <>
      <path d="M20 11a8.1 8.1 0 0 0-15.5-2m-.5-4v4h4" />
      <path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4" />
    </>,
    className,
  );

export const Back = ({ size = 18, color = 'currentColor', className }: P) =>
  svg(size, color, 2, <path d="M15 6l-6 6 6 6" />, className);

export const Chevron = ({ size = 16, color = 'currentColor', className }: P) =>
  svg(size, color, 2, <path d="M9 6l6 6-6 6" />, className);

export const Minus = ({ size = 16, color = 'currentColor', className }: P) =>
  svg(size, color, 2, <path d="M5 12h14" />, className);

export const Plus = ({ size = 16, color = 'currentColor', className }: P) =>
  svg(size, color, 2, <path d="M12 5v14M5 12h14" />, className);

export const Share = ({ size = 16, color = 'currentColor', className }: P) =>
  svg(
    size,
    color,
    2,
    <>
      <path d="M12 3v12M8 7l4-4 4 4" />
      <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </>,
    className,
  );

export const ListIcon = ({ size = 22, color = 'currentColor', className }: P) =>
  svg(size, color, 1.8, <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />, className);

export const DeploysIcon = ({ size = 22, color = 'currentColor', className }: P) =>
  svg(
    size,
    color,
    1.8,
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v9h9" />
    </>,
    className,
  );

export const Sliders = ({ size = 22, color = 'currentColor', className }: P) =>
  svg(
    size,
    color,
    1.8,
    <>
      <path d="M4 6h8M16 6h4M4 12h2M10 12h10M4 18h12" />
      <circle cx="14" cy="6" r="2" />
      <circle cx="8" cy="12" r="2" />
      <circle cx="18" cy="18" r="2" />
    </>,
    className,
  );

/** A wallet that announced no icon of its own. */
export const Wallet = ({ size = 28, color = 'currentColor', className }: P) =>
  svg(
    size,
    color,
    1.6,
    <>
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H17a1 1 0 0 1 1 1v2" />
      <path d="M4 7.5V17a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H6.5A2.5 2.5 0 0 1 4 7.5Z" />
      <path d="M16 13.5h.01" />
    </>,
    className,
  );
