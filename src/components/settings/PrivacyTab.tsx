import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { ConfirmModal } from "@/components/ui/Modal";
import { ipc, toAppError } from "@/lib/ipc";
import { formatBytes } from "@/lib/format";
import { credentialStore, dataDir } from "@/lib/platform";
import type { AppError, DataSummary } from "@/lib/types";
import { useLibrary } from "@/store/library";
import { toast } from "@/store/ui";
import { SettingRow, SettingsSection } from "./SettingRow";
import { DataTransferSection } from "./DataTransfer";

type ClearKind = "cache" | "history" | "searches" | "playtime";

const SUMMARY_KEY = ["dataSummary"] as const;

const CONFIRM: Record<ClearKind, { title: string; message: ReactNode; label: string }> = {
  cache: {
    title: "Clear cache?",
    message: "Saved Roblox API responses and cached images are deleted. They are fetched again when needed.",
    label: "Clear cache",
  },
  history: {
    title: "Clear play history?",
    message: "Recently Played and launch counts are deleted. Your library and favorites are kept.",
    label: "Clear history",
  },
  searches: {
    title: "Clear search history?",
    message: "Your recent searches are deleted.",
    label: "Clear searches",
  },
  playtime: {
    title: "Clear playtime?",
    message: "Your tracked play sessions and per-game totals are deleted. Your library, favorites and history are kept.",
    label: "Clear playtime",
  },
};

function Count({ label, value, format }: { label: string; value: number | undefined; format?: (n: number) => string }) {
  return (
    <div className="rounded-card bg-white/4 px-4 py-3">
      <div className="text-[11px] font-medium tracking-wide text-muted uppercase">{label}</div>
      <div className="mt-1 text-xl font-semibold">
        {value === undefined ? <span className="text-muted">—</span> : <AnimatedNumber value={value} format={format ?? ((n) => n.toLocaleString())} />}
      </div>
    </div>
  );
}

export function PrivacyTab() {
  const summary = useQuery<DataSummary, AppError>({
    queryKey: SUMMARY_KEY,
    queryFn: () => ipc.dataSummary(),
    staleTime: 0,
    gcTime: 0,
  });
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<ClearKind | null>(null);
  const d = summary.data;

  const run = async (kind: ClearKind) => {
    try {
      if (kind === "cache") {
        await ipc.cacheClear();
        toast.success("Cache cleared");
      } else if (kind === "history") {
        await useLibrary.getState().clearHistory();
        // clearHistory reports its own failure and restores the list.
        if (useLibrary.getState().history.length === 0) toast.success("Play history cleared");
      } else if (kind === "playtime") {
        await ipc.playtimeClear();
        void qc.invalidateQueries({ queryKey: ["playtime"] });
        toast.success("Playtime cleared");
      } else {
        await useLibrary.getState().clearSearches();
        if (useLibrary.getState().searches.length === 0) toast.success("Search history cleared");
      }
    } catch (e) {
      toast.error(`Couldn't clear: ${toAppError(e).message}`);
    }
    void summary.refetch();
  };

  const pending = confirm ?? "cache";

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection title="Stored on this PC">
        <div className="p-5">
          {summary.isError ? (
            <div className="flex items-center justify-between gap-3 text-sm text-muted">
              <span>Couldn't read storage summary: {summary.error.message}</span>
              <Button size="sm" variant="glass" onClick={() => void summary.refetch()}>
                Retry
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <Count label="Library" value={d?.libraryCount} />
              <Count label="History" value={d?.historyCount} />
              <Count label="Searches" value={d?.searchCount} />
              <Count label="Cached responses" value={d?.cacheRows} />
              <Count label="Database size" value={d?.dbBytes} format={formatBytes} />
            </div>
          )}
        </div>
      </SettingsSection>

      <SettingsSection title="Clear data">
        <SettingRow title="Cache" description="API responses and images. Safe to clear any time.">
          <Button variant="glass" size="sm" onClick={() => setConfirm("cache")}>
            Clear cache
          </Button>
        </SettingRow>
        <SettingRow title="Play history" description="Recently Played list and launch counts.">
          <Button variant="glass" size="sm" onClick={() => setConfirm("history")}>
            Clear play history
          </Button>
        </SettingRow>
        <SettingRow title="Search history" description="Recent searches shown in the search box.">
          <Button variant="glass" size="sm" onClick={() => setConfirm("searches")}>
            Clear search history
          </Button>
        </SettingRow>
        <SettingRow
          title="Playtime"
          description="Tracked play sessions. Estimated from the Roblox player process while Muffin is running."
        >
          <Button variant="glass" size="sm" onClick={() => setConfirm("playtime")}>
            Clear playtime
          </Button>
        </SettingRow>
      </SettingsSection>

      <DataTransferSection onChanged={() => void summary.refetch()} />

      <section className="surface rounded-panel p-5 text-sm">
        <h2 className="font-semibold">What Muffin stores</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
          <li>Your library and favorites, play history, playtime sessions, saved private-server codes, recent searches and settings.</li>
          <li>Cached Roblox API responses.</li>
          <li>
            All of the above live in <code className="rounded bg-white/8 px-1">{dataDir}/muffin.db</code>.
          </li>
          <li>Roblox website session cookies (one per signed-in account) are kept in {credentialStore} and never in the database. Removing an account deletes Muffin's saved session without revoking it at Roblox.</li>
        </ul>
      </section>

      <ConfirmModal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && void run(confirm)}
        title={CONFIRM[pending].title}
        message={CONFIRM[pending].message}
        confirmLabel={CONFIRM[pending].label}
        danger
      />
    </div>
  );
}
