import { HTMLAttributes } from "react";

export type BadgeGrade = "A" | "B" | "Waste";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** Produce grade this badge represents; drives the color scheme. */
  grade: BadgeGrade;
}

const GRADE_CLASSES: Record<BadgeGrade, string> = {
  A: "bg-success-light text-success",
  B: "bg-accent/10 text-accent",
  Waste: "bg-neutral-light text-neutral",
};

const GRADE_LABEL: Record<BadgeGrade, string> = {
  A: "Grade A",
  B: "Grade B",
  Waste: "Waste",
};

/**
 * Hand-Drawn Badge: pill-shaped grade indicator. Grade A = success green,
 * Grade B = accent red, Waste = neutral gray.
 */
export function Badge({ grade, className = "", children, ...rest }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-bold ${GRADE_CLASSES[grade]} ${className}`}
      {...rest}
    >
      {children ?? GRADE_LABEL[grade]}
    </span>
  );
}
