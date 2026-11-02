import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { USER_AVATAR_ATTR } from "@/lib/gameTransition";
import { UserLink } from "./UserLink";
import { BadgeCheck, Check, Ellipsis, Gamepad2, Heart, HeartOff, Loader2, Play, UserCheck, UserMinus, UserPlus, X } from "lucide-react";
import { BellButton } from "@/components/ui/BellButton";
import { ActionSwap, type ActionSwapState } from "@/components/ui/ActionSwap";
import { Menu, type MenuEntry } from "@/components/ui/Menu";
import { SmartImage } from "@/components/ui/SmartImage";
import { cn } from "@/lib/cn";
import { relativeTime } from "@/lib/format";
import { useWatch } from "@/lib/watch";
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
    <div className="relative shrink-0" style={{ width: size, height: size }} {...{ [USER_AVATAR_ATTR]: user.id }}>
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
        <UserLink userId={user.id} avatarUrl={user.avatarUrl} className="focus-ring truncate rounded font-medium hover:underline">{user.displayName}</UserLink>
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

/** Bell that turns "notify me when they come online" on or off for one friend. */
function FriendBell({ user }: { user: SocialUser }) {
  const watch = useWatch();
  return (
    <BellButton
      variant="icon"
      size="sm"
      label={`Notify me when ${user.displayName} comes online`}
      subscribed={watch.isWatching("friend", user.id)}
      onSubscribedChange={(on) => void watch.toggle("friend", user.id, on)}
    />
  );
}

const joinStates = (tone: "accent" | "quiet"): ActionSwapState[] => [
  { id: "join", label: "Join", icon: <Play {...ICON} />, tone },
  { id: "joining", label: "Joining", icon: <Loader2 {...ICON} className="animate-spin" />, tone, pendingLabel: "Joining" },
];
const JOIN_STATES = { accent: joinStates("accent"), quiet: joinStates("quiet") };

/**
 * Join pill for a friend in a game. `joining` (the joiner's state for this friend) drives the pill, so a join
 * started from a menu shows the same progress as a press. `onJoin` handles its own errors and toasts; it never rejects.
 */
export function JoinPill({
  joining,
  disabled,
  title,
  tone = "accent",
  className,
  onJoin,
}: {
  joining: boolean;
  disabled?: boolean;
  title?: string;
  tone?: "accent" | "quiet";
  className?: string;
  onJoin: () => void | PromiseLike<unknown>;
}) {
  return (
    <ActionSwap
      size="sm"
      states={JOIN_STATES[tone]}
      value={joining ? "joining" : "join"}
      disabled={disabled}
      title={title}
      className={className}
      onAction={(next) => {
        if (joining || next.id !== "joining") return;
        return onJoin();
      }}
    />
  );
}

// A pill's `pendingLabel` lives on the state it moves *into*: "Sending" on `sent`, "Cancelling" on `add`, "Accepting" on `friends`.
const ADD_STATES: ActionSwapState[] = [
  { id: "add", label: "Add friend", icon: <UserPlus {...ICON} />, tone: "accent", pendingLabel: "Cancelling" },
  { id: "sent", label: "Cancel request", icon: <X {...ICON} />, tone: "quiet", pendingLabel: "Sending" },
];
const FRIENDS_STATE: ActionSwapState = { id: "friends", label: "Friends", icon: <UserCheck {...ICON} />, tone: "success", pendingLabel: "Accepting" };
const ACCEPT_STATES: ActionSwapState[] = [{ id: "accept", label: "Accept", icon: <Check {...ICON} />, tone: "accent" }, FRIENDS_STATE];
const DECLINE_STATES: ActionSwapState[] = [
  { id: "decline", label: "Decline", icon: <X {...ICON} />, tone: "quiet" },
  { id: "declined", label: "Declined", tone: "quiet", pendingLabel: "Declining" },
];

type Act = (action: Parameters<FriendActions["run"]>[1]) => Promise<void>;

/**
 * The one pill that follows a person's relation: Add friend and Cancel request trade places, and Accept turns into
 * "Friends" when the refetch lands. Roblox is the source of truth, so the relation (not a local flag) picks the state;
 * the press only starts the action. Already-friends is a single inert state.
 */
function RelationButton({ relation, busy, act }: { relation: NonNullable<PersonRow["relation"]>; busy: boolean; act: Act }) {
  const isFriends = relation === "friends";
  const states = isFriends ? [FRIENDS_STATE] : relation === "requestReceived" ? ACCEPT_STATES : ADD_STATES;
  const value = isFriends ? "friends" : relation === "requestReceived" ? "accept" : relation === "requestSent" ? "sent" : "add";
  return (
    <ActionSwap
      size="sm"
      states={states}
      value={value}
      disabled={isFriends}
      title={relation === "requestSent" ? "Withdraw the request you sent" : undefined}
      className="disabled:opacity-100!"
      onAction={(_next, current) => {
        const action = current.id === "add" ? "send" : current.id === "sent" ? "cancel" : current.id === "accept" ? "accept" : undefined;
        return busy || !action ? undefined : act(action);
      }}
    />
  );
}

function DeclineButton({ busy, act }: { busy: boolean; act: Act }) {
  return (
    <ActionSwap
      size="sm"
      states={DECLINE_STATES}
      value="decline"
      onAction={() => (busy ? undefined : act("decline"))}
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
        <JoinPill
          joining={joiningThis}
          disabled={!p.joinable || (joiner.joining !== null && !joiningThis)}
          title={p.joinable ? `Join ${friend.displayName}` : "Roblox doesn't share which server they're in (their join settings, or a private server)"}
          onJoin={() => joiner.join(friend)}
        />
      )}
      <FriendBell user={friend} />
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
      <div className="absolute top-2 left-2">
        <FriendBell user={friend} />
      </div>
      <div className="absolute top-2 right-2">
        <MoreMenu entries={entries} label={`More actions for ${friend.displayName}`} />
      </div>
      <FriendAvatar user={friend} status={p.status} size={72} />
      <div className="flex w-full min-w-0 items-center justify-center gap-1">
        <UserLink userId={friend.id} avatarUrl={friend.avatarUrl} className="focus-ring truncate rounded font-medium hover:underline">{friend.displayName}</UserLink>
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
            <JoinPill
              joining={joiningThis}
              disabled={!p.joinable || (joiner.joining !== null && !joiningThis)}
              title={p.joinable ? `Join ${friend.displayName}` : "Roblox doesn't share which server they're in"}
              onJoin={() => joiner.join(friend)}
            />
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
  const act = (a: Parameters<FriendActions["run"]>[1]) => actions.run(person, a);
  const run = (a: Parameters<FriendActions["run"]>[1]) => void act(a);

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

  const buttons = (
    <>
      <RelationButton relation={relation} busy={busy} act={act} />
      {relation === "requestReceived" && <DeclineButton busy={busy} act={act} />}
    </>
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
        <UserLink userId={person.id} avatarUrl={person.avatarUrl} className="focus-ring truncate rounded font-medium hover:underline">{person.displayName}</UserLink>
        {person.verified && <BadgeCheck size={15} strokeWidth={1.75} className="shrink-0 text-accent" aria-label="Verified" />}
      </div>
      <div className="w-full truncate text-sm text-muted">{subtitle}</div>
      <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{buttons}</div>
    </li>
  );
}
