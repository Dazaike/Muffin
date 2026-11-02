import { CircleAlert, CircleCheck, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useRobloxStatus } from "@/lib/roblox";
import { robloxInstallHint } from "@/lib/platform";
import type { ProtocolStatus } from "@/lib/types";
import { HANDLER_LABEL } from "./handler";
import { SettingRow, SettingsSection } from "./SettingRow";

type Tone = "ok" | "warn";

function troubleshooting(s: ProtocolStatus): { tone: Tone; text: string } {
  if (!s.registered) {
    return {
      tone: "warn",
      text: `Roblox isn't registered on this PC, so roblox:// links have no handler. ${robloxInstallHint}, then press Re-check.`,
    };
  }
  if (!s.exeExists) {
    return {
      tone: "warn",
      text: `The registered launcher points to a file that no longer exists: ${s.exePath ?? s.command ?? "unknown path"}. Reinstall Roblox or your bootstrapper, then press Re-check.`,
    };
  }
  switch (s.handler) {
    case "bloxstrap":
    case "fishstrap":
      return { tone: "ok", text: `Using ${HANDLER_LABEL[s.handler]}; Muffin launches through it.` };
    case "roblox":
      return { tone: "ok", text: "Roblox Player is registered. Muffin launches through it." };
    default:
      return {
        tone: "ok",
        text: "A custom launcher handles roblox:// links. Muffin hands launches to it unchanged.",
      };
  }
}

function Value({ children }: { children: React.ReactNode }) {
  return <span className="block max-w-[420px] truncate text-sm select-text">{children}</span>;
}

const yesNo = (b: boolean) => (b ? "Yes" : "No");

export function RobloxTab() {
  const status = useRobloxStatus();
  const s = status.data;
  const advice = s ? troubleshooting(s) : null;

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection title="Launch handler">
        {status.isError ? (
          <div className="px-5 py-4 text-sm text-danger">Couldn't check Roblox: {status.error.message}</div>
        ) : !s ? (
          <div className="px-5 py-4 text-sm text-muted">Checking…</div>
        ) : (
          <>
            <SettingRow title="Handler" description="Program registered for roblox:// links.">
              <Value>{HANDLER_LABEL[s.handler]}</Value>
            </SettingRow>
            <SettingRow title="Executable path">
              <Value>{s.exePath ?? "—"}</Value>
            </SettingRow>
            <SettingRow title="Registered">
              <Value>{yesNo(s.registered)}</Value>
            </SettingRow>
            <SettingRow title="Executable exists">
              <Value>{yesNo(s.exeExists)}</Value>
            </SettingRow>
          </>
        )}
        <div className="flex items-center justify-between gap-4 px-5 py-4">
          {advice ? (
            <div className="flex min-w-0 items-start gap-2.5 text-sm">
              {advice.tone === "ok" ? (
                <CircleCheck size={18} strokeWidth={1.75} className="mt-0.5 shrink-0 text-success" />
              ) : (
                <CircleAlert size={18} strokeWidth={1.75} className="mt-0.5 shrink-0 text-amber-300" />
              )}
              <span className="text-muted">{advice.text}</span>
            </div>
          ) : (
            <span />
          )}
          <Button
            variant="glass"
            size="sm"
            disabled={status.isFetching}
            icon={<RefreshCw size={14} strokeWidth={1.75} className={status.isFetching ? "spin" : undefined} />}
            onClick={() => void status.refetch()}
          >
            Re-check
          </Button>
        </div>
      </SettingsSection>

      <p className="px-1 text-[13px] text-muted">
        Launching hands the experience to Roblox and doesn't confirm that you joined a server. Roblox Player signs in
        with its own account, which may differ from your Muffin sign-in.
      </p>
    </div>
  );
}
