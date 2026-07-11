import { InputHTMLAttributes, forwardRef } from "react";

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

/**
 * Hand-Drawn Input: bordered box matching the card/button language, with an
 * accent-colored focus ring instead of the browser default.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = "", ...rest }, ref) => {
    return (
      <input
        ref={ref}
        className={`w-full rounded-card border-2 border-primary bg-white px-4 py-3 text-lg text-primary outline-none transition-colors placeholder:text-primary/40 focus:border-accent focus:ring-2 focus:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
        {...rest}
      />
    );
  }
);

Input.displayName = "Input";
