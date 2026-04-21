import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  leftIcon?: ReactNode;
};

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--brand)] text-white shadow-[0_10px_24px_color-mix(in_oklab,var(--brand)_30%,transparent)] hover:brightness-110",
  secondary:
    "bg-[var(--surface-elevated)] text-[var(--text-strong)] border border-[var(--border)] hover:border-[var(--brand)]",
  ghost:
    "bg-transparent text-[var(--text-strong)] border border-[var(--border)] hover:bg-[var(--surface-elevated)]",
  danger:
    "bg-[var(--accent)] text-white shadow-[0_8px_24px_color-mix(in_oklab,var(--accent)_34%,transparent)] hover:brightness-105",
};

export function Button({
  children,
  className,
  variant = "primary",
  leftIcon,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition duration-200 disabled:cursor-not-allowed disabled:opacity-60 ${variantClasses[variant]} ${className ?? ""}`}
      {...props}
    >
      {leftIcon ? <span aria-hidden>{leftIcon}</span> : null}
      <span>{children}</span>
    </button>
  );
}
