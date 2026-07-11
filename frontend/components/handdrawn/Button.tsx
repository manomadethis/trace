import { ButtonHTMLAttributes, forwardRef } from "react";

export type ButtonVariant = "primary" | "accent" | "white";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style. "primary" = solid ink fill, "accent" = solid red fill,
   * "white" = white fill with ink border. Defaults to "white". */
  variant?: ButtonVariant;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-primary text-paper hover:brightness-110",
  accent: "bg-accent text-paper hover:brightness-110",
  white: "bg-white text-primary hover:bg-paper",
};

/**
 * Hand-Drawn Button: hard-edged shadow that presses flat on click, with a
 * thick ink border and bold, slightly playful type. Matches the buttons in
 * the landing-page mockup (border-2 border-primary, rounded-card, hard
 * shadow, active-press).
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "white", className = "", children, ...rest }, ref) => {
    return (
      <button
        ref={ref}
        className={`inline-flex items-center justify-center gap-2 rounded-card border-2 border-primary px-6 py-3 text-lg font-bold shadow-hard active-press transition-all disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${className}`}
        {...rest}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
