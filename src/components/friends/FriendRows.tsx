import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BadgeCheck, Check, Ellipsis, Gamepad2, Heart, HeartOff, Loader2, Play, UserMinus, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Menu, type MenuEntry } from "@/components/ui/Menu";
import { SmartImage } from "@/components/ui/SmartImage";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/format";
import type { Friend, PersonRow, PresenceStatus, SocialUser } from "@/lib/socialTypes";
import { presenceText } from "./presence";
import type { FriendActions, JoinFriend } from "./useFriends";

const ICON = { size: 16, strokeWidth: 1.75 } as const;
const ROW = "relative flex items-center gap-3 rounded-card bg-white/4 p-3 focus-within:z-20";

const DOT: Record<PresenceStatus, { color: string; label: string }> = {
  inGame: { color: "bg-success", label: "In game" },
  online: { color: "bg-sky-400", label: "Online" },
  inStudio: { color: "bg-amber-400", label: "In Studio" },
  offline: { color: "bg-white/25", label: "Offline" },
};

export function FriendAvatar({ user, status, size = 48 }: { user: SocialUser; status?: PresenceStatus; size?: number }) {
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <SmartImage src={user.avatarUrl} name={user.displayName} className="size-full rounded-full" />
      {status && (
        <span
          role="img"
          aria-label={DOT[status].label}
          title={DOT[status].label}
          className={cn("absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full border-2 border-surface", DOT[status].color)}
        />
      )}
    </div>
  );
}

function Names({ user, children }: { user: SocialUser; children?: ReactNode }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-1.5">
        <span className="truncate font-medium">{user.displayName}</span>
        {user.verified && <BadgeCheck size={15} strokeWidth={1.75} className="shrink-0 text-accent" aria-label="Verified" />}
        {user.displayName !== user.name && <span className="hidden truncate text-xs text-muted sm:inline">@{user.name}</span>}
      </div>
      {children}
    </div>
  );
}

function MoreMenu({ entries, label }: { entries: MenuEntry[]; label: string }) {
  return (
    <Menu
      entries={entries}
      trigger={(props) => (
        <button
          type="button"
          {...props}
          aria-label={label}
          className="focus-ring flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-white/8 hover:text-fg"
        >
          <Ellipsis size={18} strokeWidth={1.75} />
        </button>
      )}
    />
  );
}

export function FriendRow({
  friend,
  joiner,
  onUnfriend,
}: {
  friend: Friend;
  joiner: JoinFriend;
  onUnfriend: (user: SocialUser) => void;
}) {
  const navigate = useNavigate();
  const p = friend.presence;
  const gamePlace = p.rootPlaceId ?? p.placeId;
  const joiningThis = joiner.joining === friend.id;
  const inGame = p.status === "inGame";
  const entries: MenuEntry[] = [
    {
      label: "Join game",
      icon: <Play {...ICON} />,
      disabled: !p.joinable || joiner.joining !== null,
      title: p.joinable ? undefined : "They aren't in a game you can join right now",
      onSelect: () => void joiner.join(friend),
    },
    ...(gamePlace && inGame
      ? [{ label: "View game", icon: <Gamepad2 {...ICON} />, onSelect: () => navigate(`/game/${gamePlace}`) } satisfies MenuEntry]
      : []),
    { type: "separator" },
    { label: "Unfriend", icon: <UserMinus {...ICON} />, danger: true, onSelect: () => onUnfriend(friend) },
  ];

  return (
    <li className={ROW}>
      <FriendAvatar user={friend} status={p.status} />
      <Names user={friend}>
        <div className={cn("truncate text-sm", inGame ? "text-success" : "text-muted")}>
          {inGame && gamePlace ? (
            <Link to={`/game/${gamePlace}`} className="focus-ring rounded hover:underline">
              {presenceText(p)}
            </Link>
          ) : (
            presenceText(p)
          )}
        </div>
      </Names>
      {inGame && (
        <Button
          variant="primary"
          size="sm"
          icon={joiningThis ? <Loader2 {...ICON} className="animate-spin" /> : <Play {...ICON} />}
          disabled={!p.joinable || joiner.joining !== null}
          title={p.joinable ? `Join ${friend.displayName}` : "Roblox doesn't share which server they're in (their join settings, or a private server)"}
          onClick={() => void joiner.join(friend)}
        >
          {joiningThis ? "Joining…" : "Join"}
        </Button>
      )}
      <MoreMenu entries={entries} label={`More actions for ${friend.displayName}`} />
    </li>
  );
}

/** Grid-mode tile for a friend: avatar-forward, same actions as FriendRow. */
export function FriendCard({
  friend,
  joiner,
  onUnfriend,
}: {
  friend: Friend;
  joiner: JoinFriend;
  onUnfriend: (user: SocialUser) => void;
}) {
  const navigate = useNavigate();
  const p = friend.presence;
  const gamePlace = p.rootPlaceId ?? p.placeId;
  const joiningThis = joiner.joining === friend.id;
  const inGame = p.status === "inGame";
  const entries: MenuEntry[] = [
    {
      label: "Join game",
      icon: <Play {...ICON} />,
      disabled: !p.joinable || joiner.joining !== null,
      title: p.joinable ? undefined : "They aren't in a game you can join right now",
      onSelect: () => void joiner.join(friend),
    },
    ...(gamePlace && inGame
      ? [{ label: "View game", icon: <Gamepad2 {...ICON} />, onSelect: () => navigate(`/game/${gamePlace}`) } satisfies MenuEntry]
      : []),
    { type: "separator" },
    { label: "Unfriend", icon: <UserMinus {...ICON} />, danger: true, onSelect: () => onUnfriend(friend) },
  ];
  return (
    <li className="group/card relative flex flex-col items-center gap-2 rounded-card bg-white/4 p-4 text-center focus-within:z-20">
      <div className="absolute top-2 right-2">
        <MoreMenu entries={entries} label={`More actions for ${friend.displayName}`} />
      </div>
      <FriendAvatar user={friend} status={p.status} size={72} />
      <div className="flex w-full min-w-0 items-center justify-center gap-1">
        <span className="truncate font-medium">{friend.displayName}</span>
        {friend.verified && <BadgeCheck size={15} strokeWidth={1.75} className="shrink-0 text-accent" aria-label="Verified" />}
      </div>
      <div className={cn("w-full truncate text-sm", inGame ? "text-success" : "text-muted")}>
        {inGame && gamePlace ? (
          <Link to={`/game/${gamePlace}`} className="focus-ring rounded hover:underline">
            {presenceText(p)}
          </Link>
        ) : (
          presenceText(p)
        )}
      </div>
      {inGame && (
        <div className="grid w-full grid-rows-[0fr] opacity-0 transition-[grid-template-rows,opacity] duration-200 group-focus-within/card:grid-rows-[1fr] group-focus-within/card:opacity-100 group-hover/card:grid-rows-[1fr] group-hover/card:opacity-100">
          <div className="overflow-hidden">
            <Button
              variant="primary"
              size="sm"
              icon={joiningThis ? <Loader2 {...ICON} className="animate-spin" /> : <Play {...ICON} />}
              disabled={!p.joinable || joiner.joining !== null}
              title={p.joinable ? `Join ${friend.displayName}` : "Roblox doesn't share which server they're in"}
              onClick={() => void joiner.join(friend)}
            >
              {joiningThis ? "Joining…" : "Join"}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

/** Where a person row is shown; changes the subtitle and which actions make sense. */
export type PersonContext = "requests" | "followers" | "following" | "search";

interface PersonProps {
  person: PersonRow;
  context: PersonContext;
  actions: FriendActions;
  onUnfriend: (user: SocialUser) => void;
}

/** Subtitle, menu entries and busy state shared by the row and card renderings of a person. */
function personModel({ person, context, actions, onUnfriend }: PersonProps) {
  const busy = actions.pending.has(person.id);
  const relation = person.relation ?? "notFriends";
  const run = (a: Parameters<FriendActions["run"]>[1]) => void actions.run(person, a);

  const subtitle =
    context === "requests"
      ? [
          person.sentAt && Number.isFinite(Date.parse(person.sentAt)) ? `Sent ${relativeTime(Date.parse(person.sentAt))}` : null,
          person.mutualFriends > 0 ? `${person.mutualFriends} mutual friend${person.mutualFriends === 1 ? "" : "s"}` : null,
        ]
          .filter(Boolean)
          .join(" · ") || `@${person.name}`
      : `@${person.name}`;

  const entries: MenuEntry[] = [
    person.following
      ? { label: "Unfollow", icon: <HeartOff {...ICON} />, onSelect: () => run("unfollow"), disabled: busy }
      : { label: "Follow", icon: <Heart {...ICON} />, onSelect: () => run("follow"), disabled: busy },
    ...(relation === "friends"
      ? [{ type: "separator" } satisfies MenuEntry, { label: "Unfriend", icon: <UserMinus {...ICON} />, danger: true, onSelect: () => onUnfriend(person) } satisfies MenuEntry]
      : []),
  ];

  const buttons =
    relation === "requestReceived" ? (
      <>
        <Button variant="primary" size="sm" icon={<Check {...ICON} />} disabled={busy} onClick={() => run("accept")}>
          Accept
        </Button>
        <Button variant="glass" size="sm" icon={<X {...ICON} />} disabled={busy} onClick={() => run("decline")}>
          Decline
        </Button>
      </>
    ) : relation === "requestSent" ? (
      <Button variant="glass" size="sm" disabled={busy} title="Withdraw the request you sent" onClick={() => run("cancel")}>
        {busy ? "Cancelling…" : "Cancel request"}
      </Button>
    ) : relation === "friends" ? (
      <span className="rounded-full bg-white/8 px-2.5 py-1 text-xs text-muted">Friends</span>
    ) : (
      <Button variant="glass" size="sm" icon={<UserPlus {...ICON} />} disabled={busy} onClick={() => run("send")}>
        {busy ? "Sending…" : "Add friend"}
      </Button>
    );

  return { subtitle, entries, buttons };
}

export function PersonRowView(props: PersonProps) {
  const { person } = props;
  const { subtitle, entries, buttons } = personModel(props);
  return (
    <li className={ROW}>
      <FriendAvatar user={person} />
      <Names user={person}>
        <div className="truncate text-sm text-muted">{subtitle}</div>
      </Names>
      {buttons}
      <MoreMenu entries={entries} label={`More actions for ${person.displayName}`} />
    </li>
  );
}

/** Grid-mode tile for a person: avatar-forward, same actions as PersonRowView. */
export function PersonCard(props: PersonProps) {
  const { person } = props;
  const { subtitle, entries, buttons } = personModel(props);
  return (
    <li className="relative flex flex-col items-center gap-2 rounded-card bg-white/4 p-4 text-center focus-within:z-20">
      <div className="absolute top-2 right-2">
        <MoreMenu entries={entries} label={`More actions for ${person.displayName}`} />
      </div>
      <FriendAvatar user={person} size={72} />
      <div className="flex w-full min-w-0 items-center justify-center gap-1">
        <span className="truncate font-medium">{person.displayName}</span>
        {person.verified && <BadgeCheck size={15} strokeWidth={1.75} className="shrink-0 text-accent" aria-label="Verified" />}
      </div>
      <div className="w-full truncate text-sm text-muted">{subtitle}</div>
      <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{buttons}</div>
    </li>
  );
}
