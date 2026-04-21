import type { HTMLAttributes } from "react";

type CardProps = HTMLAttributes<HTMLDivElement> & {
  tone?: "default" | "emergency" | "recommended";
};

const toneClasses: Record<NonNullable<CardProps["tone"]>, string> = {
  default: "border-[var(--border)] bg-[var(--surface-overlay-strong)]",
  emergency:
    "border-[color:color-mix(in_oklab,var(--accent)_50%,var(--border))] bg-[color:color-mix(in_oklab,var(--surface)_76%,var(--accent-soft))]",
  recommended:
    "border-[color:color-mix(in_oklab,var(--brand)_58%,var(--border))] bg-[color:color-mix(in_oklab,var(--surface)_78%,var(--brand-soft))]",
};

export function Card({ className, tone = "default", ...props }: CardProps) {
  return (
    <div
      className={`rounded-3xl border p-4 shadow-[0_16px_34px_rgba(8,24,38,0.12)] backdrop-blur-md ${toneClasses[tone]} ${className ?? ""}`}
      {...props}
    />
  );
}
