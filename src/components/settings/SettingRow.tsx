import type { ReactNode } from "react";

/** Card that groups related rows; rows are separated by hairlines. */
export function SettingsSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      {title && <h2 className="px-1 text-xs font-medium tracking-wide text-muted uppercase">{title}</h2>}
      <div className="surface divide-y divide-white/6 rounded-panel">{children}</div>
    </section>
  );
}

/** Label + description on the left, control on the right. */
export function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        {description && <div className="mt-0.5 text-[13px] text-muted">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
