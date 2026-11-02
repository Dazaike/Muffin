import { useQuery } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, Info } from "lucide-react";
import { Switch } from "@/components/ui/Controls";
import { relativeTime } from "@/lib/format";
import { ipc } from "@/lib/ipc";
import type { AppError, NotifierStatus } from "@/lib/types";
import { useSettings } from "@/store/settings";
import { useWatch } from "@/lib/watch";
import { SettingRow, SettingsSection } from "./SettingRow";

function describe(s: NotifierStatus): { ok: boolean; text: string } {
  switch (s.state) {
    case "starting":
      return { ok: true, text: "Starting… the first check runs a few seconds after Muffin opens." };
    case "disabled":
      return { ok: true, text: "All notification types are off and no friends or games are watched, so nothing is being checked." };
    case "no_account":
      return { ok: false, text: "No Roblox account is signed in. Add one in Profile to get notifications." };
    case "stopped":
      return { ok: false, text: s.stoppedReason ?? "Paused: the Roblox session was rejected. Sign in again to resume." };
    case "running":
      return {
        ok: true,
        text: s.lastPollAt ? `Watching your active account. Last checked ${relativeTime(s.lastPollAt)}.` : "Watching your active account.",
      };
  }
}

const count = (n: number | null) => (n === null ? "—" : String(n));

export function NotificationsTab() {
  const v = useSettings((s) => s.values);
  const set = useSettings((s) => s.set);
  const watch = useWatch();
  const status = useQuery<NotifierStatus, AppError>({
    queryKey: ["notifierStatus"],
    queryFn: () => ipc.notifierStatus(),
    staleTime: 0,
    refetchInterval: 5_000,
  });
  const s = status.data;
  const info = s ? describe(s) : null;

  return (
    <SettingsSection title="Roblox notifications">
      <SettingRow title="New messages" description="Notify when you have new unread Roblox chat messages. Only the count is shown, never the message text.">
        <Switch label="New message notifications" checked={v.notifyMessages} onChange={(x) => void set("notifyMessages", x)} />
      </SettingRow>
      <SettingRow title="Friend requests" description="Notify when you receive a new friend request.">
        <Switch
          label="Friend request notifications"
          checked={v.notifyFriendRequests}
          onChange={(x) => void set("notifyFriendRequests", x)}
        />
      </SettingRow>
      <SettingRow
        title="Friends coming online"
        description="Notify when a friend comes online. Can be chatty with many friends, so it is off by default."
      >
        <Switch
          label="Friends online notifications"
          checked={v.notifyFriendsOnline}
          onChange={(x) => void set("notifyFriendsOnline", x)}
        />
      </SettingRow>
      <SettingRow
        title="Only when Muffin isn't in front"
        description="Skip notifications while the Muffin window is visible and focused. Hidden, minimized or behind another window still notifies."
      >
        <Switch
          label="Only notify when Muffin isn't in front"
          checked={v.notifyOnlyWhenHidden}
          onChange={(x) => void set("notifyOnlyWhenHidden", x)}
        />
      </SettingRow>
      <SettingRow
        title="Bell buttons"
        description="The bell on a friend or game page. Watched friends notify when they come online even with the switch above off; watched games notify when they are updated. Messages can't be watched per person: Muffin only reads unread counts."
      >
        <span className="text-sm text-muted tabular-nums">
          Watching {watch.friends.size} {watch.friends.size === 1 ? "friend" : "friends"} and {watch.games.size}{" "}
          {watch.games.size === 1 ? "game" : "games"}
        </span>
      </SettingRow>

      <div className="flex flex-col gap-2 px-5 py-4 text-sm">
        {status.isError ? (
          <div className="flex items-start gap-2.5 text-danger">
            <CircleAlert size={18} strokeWidth={1.75} className="mt-0.5 shrink-0" />
            <span>Couldn't read notification status: {status.error.message}</span>
          </div>
        ) : !s || !info ? (
          <span className="text-muted">Checking…</span>
        ) : (
          <>
            <div className="flex items-start gap-2.5">
              {info.ok ? (
                <CircleCheck size={18} strokeWidth={1.75} className="mt-0.5 shrink-0 text-success" />
              ) : (
                <CircleAlert size={18} strokeWidth={1.75} className="mt-0.5 shrink-0 text-amber-300" />
              )}
              <span className="text-muted">{info.text}</span>
            </div>
            {(s.state === "running" || s.state === "stopped") && (
              <div className="pl-[27px] text-[13px] text-muted tabular-nums">
                Unread messages: {count(s.unreadMessages)} · Friend requests: {count(s.friendRequests)}
                {v.notifyFriendsOnline && <> · Friends online: {count(s.friendsOnline)}</>}
              </div>
            )}
            {s.lastError && <div className="pl-[27px] text-[13px] text-amber-300">{s.lastError}</div>}
          </>
        )}
        <div className="mt-1 flex items-start gap-2.5 text-[13px] text-muted">
          <Info size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" />
          <span>
            Muffin checks about every 45 seconds and only while it is running; set "When closing the window" to Minimize to
            tray to keep it running in the background. Roblox may rate-limit these requests, in which case Muffin backs off and
            checks less often. The first check after starting or switching accounts only records what is already there.
          </span>
        </div>
      </div>
    </SettingsSection>
  );
}
