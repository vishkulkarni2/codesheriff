import { cn } from "@/lib/utils";

interface LogoIconProps {
  className?: string;
  size?: number;
}

/**
 * CodeSheriff logo icon — 5-point star badge with </> inside.
 *
 * Star geometry: center (16,16), outer r=14, inner r=5.8
 * The </> symbol sits inside the star with dark-green contrast strokes.
 * Flat design, no gradients. Scales cleanly from 16px (favicon) to 200px+.
 */
export function LogoIcon({ className, size }: LogoIconProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      width={size}
      height={size}
      aria-hidden="true"
      className={className}
    >
      {/* 5-point sheriff star — filled flat green */}
      <path
        d="M16 2 L19.41 11.31 L29.31 11.67 L21.52 17.79 L24.23 27.33 L16 21.8 L7.77 27.33 L10.48 17.79 L2.69 11.67 L12.59 11.31 Z"
        fill="#4ade80"
      />
      {/* < bracket */}
      <path
        d="M13 12.5 L11.2 16 L13 19.5"
        stroke="#052e16"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* / slash */}
      <path
        d="M15.8 19 L17.5 13"
        stroke="#052e16"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      {/* > bracket */}
      <path
        d="M19 12.5 L20.8 16 L19 19.5"
        stroke="#052e16"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface LogoProps {
  className?: string;
  iconSize?: number;
  /** When true, renders icon only (no text). */
  iconOnly?: boolean;
}

export function Logo({ className, iconSize = 32, iconOnly = false }: LogoProps) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <LogoIcon size={iconSize} />
      {!iconOnly && (
        <span className="font-semibold tracking-tight">
          Code<span className="text-primary">Sheriff</span>
        </span>
      )}
    </span>
  );
}
