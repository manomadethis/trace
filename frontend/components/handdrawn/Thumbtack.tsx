import { HTMLAttributes } from "react";

export interface ThumbtackProps extends HTMLAttributes<HTMLDivElement> {
  /** Tack head color. Defaults to accent red. */
  color?: string;
}

/**
 * Decorative pushpin/thumbtack — a small circle meant to sit centered on a
 * Card's top edge, overlapping its border, to sell the hand-pinned-to-a-
 * corkboard look.
 */
export function Thumbtack({
  color = "var(--color-accent)",
  className = "",
  style,
  ...rest
}: ThumbtackProps) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute -top-3 left-1/2 h-6 w-6 -translate-x-1/2 rounded-full border-2 border-primary shadow-hard ${className}`}
      style={{ backgroundColor: color, ...style }}
      {...rest}
    />
  );
}
