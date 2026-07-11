import { HTMLAttributes } from "react";

export interface TapeProps extends HTMLAttributes<HTMLDivElement> {
  /** Rotation of the tape strip, in degrees. Defaults to 2 (matches mockup). */
  rotate?: number;
}

/**
 * Decorative strip of "tape" — a semi-transparent rectangle meant to sit at
 * the top edge of a Card, overlapping its border, to sell the hand-placed
 * paper-craft look (see landing-page mockup's tape decoration).
 */
export function Tape({ rotate = 2, className = "", style, ...rest }: TapeProps) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute -top-3 left-1/2 h-8 w-16 -translate-x-1/2 border border-primary/20 bg-yellow-100/60 mix-blend-multiply ${className}`}
      style={{ transform: `rotate(${rotate}deg)`, ...style }}
      {...rest}
    />
  );
}
