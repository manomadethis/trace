import { HTMLAttributes } from "react";
import { Tape } from "./Tape";
import { Thumbtack } from "./Thumbtack";

export type CardWobble = 1 | 2 | 3 | "none";
export type CardDecoration = "tape" | "tack" | "none";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Small fixed rotation for a hand-placed feel. Defaults to "none". */
  wobble?: CardWobble;
  /** Optional decorative element pinned to the card's top edge. */
  decoration?: CardDecoration;
}

const WOBBLE_CLASSES: Record<CardWobble, string> = {
  1: "wobble-1",
  2: "wobble-2",
  3: "wobble-3",
  none: "",
};

/**
 * Hand-Drawn Card: white surface, thick ink border, hard shadow, and an
 * optional slight rotation plus a tape/thumbtack decoration — matches the
 * cards in the landing-page mockup.
 */
export function Card({
  wobble = "none",
  decoration = "none",
  className = "",
  children,
  ...rest
}: CardProps) {
  return (
    <div
      className={`relative rounded-card border-2 border-primary bg-white p-6 shadow-hard ${WOBBLE_CLASSES[wobble]} ${className}`}
      {...rest}
    >
      {decoration === "tape" && <Tape />}
      {decoration === "tack" && <Thumbtack />}
      {children}
    </div>
  );
}
