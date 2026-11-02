import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { LogIn, Users } from "lucide-react";
import { sortFriends, presenceText } from "@/components/friends/presence";
import { useFriendsList, useJoinFriend, useSocialSession } from "@/components/friends/useFriends";
import { useOpenUser } from "@/components/friends/UserLink";
import { USER_AVATAR_ATTR } from "@/lib/gameTransition";
import { JoinPill } from "@/components/friends/FriendRows";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { SmartImage } from "@/components/ui/SmartImage";
import { cn } from "@/lib/cn";
import type { Friend } from "@/lib/socialTypes";
import { useAccount } from "@/store/account";
import { AvatarStage } from "./AvatarStage";

const BANNER_H = "clamp(210px, 30vh, 270px)";
const DOT: Record<Friend["presence"]["status"], string> = {
  inGame: "bg-success",
  online: "bg-accent",
  inStudio: "bg-warning",
  offline: "bg-muted",
};

function FriendTile({ friend, joining, onJoin, onOpen }: { friend: Friend; joining: boolean; onJoin: () => Promise<void>; onOpen: (source: HTMLElement | null) => void }) {
  const p = friend.presence;
  return (
    <div className="flex min-w-0 items-center gap-1 rounded-[10px] px-0.5 py-0 transition-colors hover:bg-white/5">
      <button
        type="button"
        onClick={(e) => onOpen(e.currentTarget.querySelector("img")?.parentElement ?? null)}
        aria-label={`View ${friend.displayName}'s profile`}
        className="focus-ring flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-[8px] px-1.5 py-1 text-left"
      >
        <div className="relative shrink-0" {...{ [USER_AVATAR_ATTR]: friend.id }}>
          <SmartImage src={friend.avatarUrl} name={friend.displayName} className="size-8 rounded-full" />
          <span className={cn("absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-[var(--surface-solid,#0d0d12)]", DOT[p.status])} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold leading-tight text-fg">{friend.displayName}</div>
          <div className="truncate text-[11px] leading-tight text-muted">{presenceText(p)}</div>
        </div>
      </button>
      {p.status === "inGame" && p.joinable && <JoinPill joining={joining} tone="quiet" onJoin={onJoin} className="mr-1" />}
    </div>
  );
}

function FriendsPanel({ userId }: { userId: number | null }) {
  const navigate = useNavigate();
  const openUser = useOpenUser();
  const signIn = useAccount((s) => s.signIn);
  const session = useSocialSession();
  const list = useFriendsList(userId);
  const { joining, join } = useJoinFriend(userId);

  const online = useMemo(() => sortFriends((list.data?.friends ?? []).filter((f) => f.presence.status !== "offline")), [list.data]);

  let body;
  if (!session.loaded || (userId !== null && list.isPending)) {
    body = (
      <div className="grid grid-cols-1 gap-1">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-9" />
        ))}
      </div>
    );
  } else if (userId === null) {
    body = (
      <div className="flex flex-1 flex-col items-start justify-center gap-3 text-sm text-muted">
        {session.expired ? "Your Roblox session expired." : "Sign in to see which friends are online."}
        <Button variant="primary" size="md" icon={<LogIn size={16} strokeWidth={1.75} />} onClick={() => void signIn()}>
          Sign in
        </Button>
      </div>
    );
  } else if (list.isError) {
    body = <div className="text-sm text-danger">{list.error.message}</div>;
  } else if (online.length === 0) {
    body = <div className="py-1 text-sm text-muted">No friends are online right now.</div>;
  } else {
    body = (
      <div className="grid grid-cols-1 content-start gap-y-0 overflow-y-auto">
        {online.map((f) => (
          <FriendTile key={f.id} friend={f} joining={joining === f.id} onJoin={() => join(f)} onOpen={(source) => openUser(f.id, source, f.avatarUrl)} />
        ))}
      </div>
    );
  }

  return (
    <div className="surface flex min-h-0 min-w-0 flex-col gap-1.5 rounded-card p-3.5" style={{ maxHeight: BANNER_H }}>
      <div className="flex items-center gap-2">
        <Users size={18} strokeWidth={1.75} className="text-muted" />
        <h2 className="text-base font-semibold text-fg">Friends online</h2>
        {userId !== null && online.length > 0 && (
          <span className="rounded-full bg-white/8 px-2 py-0.5 text-xs text-muted tabular-nums">{online.length}</span>
        )}
        <Button variant="glass" size="sm" className="ml-auto border border-white/10" onClick={() => navigate("/friends")}>
          All friends
        </Button>
      </div>
      {body}
    </div>
  );
}

function AvatarPanel({ userId }: { userId: number | null }) {
  const user = useAccount((s) => s.status?.user);
  return (
    <div className="surface relative ml-auto w-[200px] shrink-0 overflow-hidden rounded-card bg-[radial-gradient(ellipse_at_50%_100%,rgba(255,255,255,0.07),transparent_70%)]" style={{ height: BANNER_H }}>
      <AvatarStage userId={userId} name={user?.displayName} fallbackSrc={user?.avatarUrl} />
    </div>
  );
}

const GREETINGS = [
  (n: string) => `Welcome back, ${n}`,
  (n: string) => `Hey ${n}, ready to play?`,
  (n: string) => `Good to see you, ${n}`,
  (n: string) => `What's the game today, ${n}?`,
  (n: string) => `${n} is in the building`,
  (n: string) => `Let's go, ${n}`,
  (n: string) => `Hi ${n}`,
];
/** Advances on every Home visit, so each return shows the next line. */
let visits = Math.floor(Math.random() * GREETINGS.length);

/** Top-right greeting. Next line on each Home visit and on click. */
function WelcomeBanner({ name }: { name: string }) {
  const [index, setIndex] = useState(() => visits++ % GREETINGS.length);
  const text = (GREETINGS[index % GREETINGS.length] ?? GREETINGS[0]!)(name);
  return (
    <button
      type="button"
      onClick={() => setIndex((i) => (i + 1) % GREETINGS.length)}
      aria-label={`${text}. Click for another greeting`}
      className="focus-ring -ml-1 cursor-pointer truncate rounded-md px-1 py-0.5 text-left text-lg font-semibold text-fg transition-opacity hover:opacity-80"
    >
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={index}
          className="truncate"
          initial={{ opacity: 0, y: 8, filter: "blur(2px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -8, filter: "blur(2px)" }}
          transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
        >
          {text}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

/** Top of Home: a greeting over the online friends, next to the signed-in user's avatar in 3D. */
export function HomeBanner() {
  const { userId } = useSocialSession();
  const user = useAccount((s) => s.status?.user);
  return (
    <section aria-label="Friends and avatar" className="flex items-start gap-3">
      <div className="flex w-[300px] min-w-0 shrink-0 flex-col gap-1.5">
        {user && <WelcomeBanner name={user.displayName} />}
        <FriendsPanel userId={userId} />
      </div>
      <AvatarPanel userId={userId} />
    </section>
  );
}
