import { useNavigate } from "react-router-dom";
import { useRobuxBalance } from "@/hooks/useRobuxBalance";
import { formatRobux } from "@/lib/economy";
import { formatCompact } from "@/lib/format";
import { useAccount } from "@/store/account";
import { useSettings } from "@/store/settings";

/** Hexagon "R$" mark. */
function RobuxMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden className="shrink-0">
      <path
        d="M12 1.8 21 7v10l-9 5.2L3 17V7z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <text x="12" y="15.4" textAnchor="middle" fontSize="8.5" fontWeight="700" fill="currentColor" fontFamily="inherit">
        R$
      </text>
    </svg>
  );
}

/** Robux balance of the active account, top-right. Hidden for guests; opens the Wallet. */
export function RobuxBadge() {
  const navigate = useNavigate();
  const show = useSettings((s) => s.values.showRobux);
  const status = useAccount((s) => s.status);
  const signedIn = !!status?.signedIn && !status.expired;
  const balance = useRobuxBalance(signedIn && show);
  if (!signedIn || !show) return null;

  const title =
    balance.data !== undefined
      ? `${formatRobux(balance.data)} Robux`
      : balance.isError
        ? `Robux balance unavailable: ${balance.error.message}`
        : "Loading Robux balance…";

  return (
    <button
      type="button"
      onClick={() => navigate("/wallet")}
      title={title}
      aria-label={title}
      className="focus-ring flex h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-white/8 bg-white/5 pr-3.5 pl-3 text-sm font-medium tabular-nums transition-colors hover:bg-white/10"
    >
      <span className="text-accent">
        <RobuxMark />
      </span>
      {balance.data !== undefined ? (
        formatCompact(balance.data)
      ) : balance.isError ? (
        <span className="text-muted">—</span>
      ) : (
        <span className="skeleton inline-block h-4 w-10 rounded-md" aria-hidden />
      )}
    </button>
  );
}
