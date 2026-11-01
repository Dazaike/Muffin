import { motion } from "motion/react";
import { ArrowDownLeft, ArrowUpRight, Clock } from "lucide-react";
import type { ViewMode } from "@/components/lists/ViewToggle";
import { cn } from "@/lib/cn";
import { formatRobux, formatWhen, signedRobux, type Transaction } from "@/lib/economy";
import { useMotionPrefs } from "@/lib/motion";

/** One read-only transaction: a row (`list`) or a compact card (`grid`). */
export function TransactionRow({
  tx,
  fallbackTitle,
  index,
  view = "list",
}: {
  tx: Transaction;
  fallbackTitle: string;
  index: number;
  view?: ViewMode;
}) {
  const m = useMotionPrefs();
  const incoming = tx.amount >= 0;
  const robux = tx.currency === "Robux";
  const meta = [tx.itemType, tx.place, tx.agent, formatWhen(tx.created)].filter(Boolean).join(" · ");
  const title = tx.name ?? fallbackTitle;

  const pending = tx.isPending && (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/8 px-2 py-0.5 text-[11px] text-muted">
      <Clock size={11} strokeWidth={1.75} />
      Pending
    </span>
  );
  const icon = (
    <div
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full",
        incoming ? "bg-success/15 text-success" : "bg-danger/15 text-danger",
      )}
      aria-hidden
    >
      {incoming ? <ArrowDownLeft size={17} strokeWidth={1.75} /> : <ArrowUpRight size={17} strokeWidth={1.75} />}
    </div>
  );
  const amount = (
    <div
      className={cn(
        "shrink-0 text-right text-sm font-semibold tabular-nums",
        tx.amount === 0 ? "text-muted" : incoming ? "text-success" : "text-danger",
      )}
      title={`${formatRobux(Math.abs(tx.amount))} ${tx.currency}`}
    >
      {signedRobux(tx.amount)}
      <span className="ml-1 text-[11px] font-normal text-muted">{robux ? "R$" : tx.currency}</span>
    </div>
  );

  if (view === "grid") {
    return (
      <motion.li
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...m.fast, ...m.stagger(index) }}
        className="flex flex-col gap-2 rounded-[12px] bg-white/4 p-3"
      >
        <div className="flex items-center justify-between gap-2">
          {icon}
          {amount}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium" title={title}>
            {title}
          </div>
          <div className="line-clamp-2 text-xs text-muted">{meta}</div>
        </div>
        {pending && <div>{pending}</div>}
      </motion.li>
    );
  }

  return (
    <motion.li
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...m.fast, ...m.stagger(index) }}
      className="flex items-center gap-3 rounded-[12px] bg-white/4 px-3 py-2.5"
    >
      {icon}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{title}</div>
        <div className="truncate text-xs text-muted">{meta}</div>
      </div>
      {pending}
      {amount}
    </motion.li>
  );
}
