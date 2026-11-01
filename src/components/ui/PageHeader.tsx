import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  /** Right-aligned controls. */
  actions?: ReactNode;
  className?: string;
}

/** Standard page title block. */
export function PageHeader({ title, subtitle, actions, className }: PageHeaderProps) {
  return (
    <div className={cn("flex items-end justify-between gap-4 pt-6 pb-5", className)}>
      <div className="min-w-0">
        <h1 className="truncate text-[28px] leading-tight font-semibold tracking-tight">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Page content container: max width 1500, responsive side padding. */
export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("page-pad mx-auto w-full max-w-[1500px] pb-12", className)}>{children}</div>;
}
