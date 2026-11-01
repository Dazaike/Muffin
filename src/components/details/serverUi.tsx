import type { ReactNode } from "react";

export const inputClass =
  "focus-ring h-10 w-full rounded-[12px] bg-white/6 px-3 text-sm outline-none transition-colors placeholder:text-muted/70 focus:bg-white/10";

export function IconBtn({
  label,
  onClick,
  danger,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`focus-ring flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50 ${
        danger ? "hover:text-danger" : "hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}

export function InlineError({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="rounded-[12px] bg-danger/12 px-3 py-2 text-sm text-danger">
      {children}
    </div>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <div className="rounded-[12px] bg-white/5 px-3 py-2 text-xs text-muted">{children}</div>;
}
