import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { LogIn, RefreshCw, UserRound } from "lucide-react";
import { FindTab } from "@/components/friends/FindTab";
import { FriendsTab } from "@/components/friends/FriendsTab";
import { PeopleList } from "@/components/friends/PeopleList";
import {
  friendsKey,
  useFriendActions,
  useFriendsList,
  useJoinFriend,
  usePeople,
  usePresencePolling,
  useRequestCount,
  useSocialSession,
} from "@/components/friends/useFriends";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/Modal";
import { Page, PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/StateSwitch";
import { Tabs, type TabItem } from "@/components/ui/Tabs";
import { useMotionPrefs } from "@/lib/motion";
import { credentialStore } from "@/lib/platform";
import type { SocialUser } from "@/lib/socialTypes";
import { useAccount } from "@/store/account";

type TabId = "friends" | "requests" | "find";

function SignedOut({ loaded, expired }: { loaded: boolean; expired: boolean }) {
  const signIn = useAccount((s) => s.signIn);
  const signingIn = useAccount((s) => s.signingIn);
  if (!loaded) return <Skeleton className="h-40 w-full" />;
  return (
    <EmptyState
      icon={<UserRound size={22} strokeWidth={1.75} />}
      title={expired ? "Your Roblox session expired" : "Sign in to see your friends"}
      hint={`Friends, requests and presence come from your Roblox account. Muffin signs in through its own Roblox login window and keeps the session in ${credentialStore}.`}
      action={
        <Button variant="primary" icon={<LogIn size={16} strokeWidth={1.75} />} disabled={signingIn} onClick={() => void signIn()}>
          {signingIn ? "Waiting for sign-in…" : expired ? "Sign in again" : "Sign in to Roblox"}
        </Button>
      }
    />
  );
}

function FriendsBody({ userId }: { userId: number }) {
  const m = useMotionPrefs();
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabId>("friends");
  const [unfriend, setUnfriend] = useState<{ user: SocialUser; open: boolean } | null>(null);

  const list = useFriendsList(userId);
  const requestCount = useRequestCount(userId);
  const actions = useFriendActions(userId);
  const joiner = useJoinFriend(userId);
  const { stale } = usePresencePolling(userId, tab === "friends");

  const requests = usePeople(userId, "requests", "", tab === "requests");

  const askUnfriend = (user: SocialUser) => setUnfriend({ user, open: true });
  const pendingRequests = requestCount.data ?? 0;
  const friends = list.data?.friends;
  const online = friends?.filter((f) => f.presence.status !== "offline").length ?? 0;

  const tabs: TabItem<TabId>[] = [
    { id: "friends", label: "Friends", count: list.data?.total },
    { id: "requests", label: "Requests", count: pendingRequests > 0 ? pendingRequests : undefined },
    { id: "find", label: "Find users" },
  ];

  return (
    <>
      <PageHeader
        title="Friends"
        subtitle={list.data ? `${list.data.total} ${list.data.total === 1 ? "friend" : "friends"} · ${online} online` : "Your Roblox friends and requests"}
        actions={
          <Button
            variant="glass"
            size="sm"
            icon={<RefreshCw size={15} strokeWidth={1.75} className={list.isFetching ? "animate-spin" : undefined} />}
            disabled={list.isFetching}
            onClick={() => void qc.invalidateQueries({ queryKey: friendsKey(userId) })}
          >
            Refresh
          </Button>
        }
      />
      <Tabs tabs={tabs} value={tab} onChange={setTab} className="mb-5 flex-wrap" />

      <motion.div key={tab} initial={{ opacity: 0, y: m.full ? 6 : 0 }} animate={{ opacity: 1, y: 0 }} transition={m.fast}>
        {tab === "friends" && (
          <FriendsTab userId={userId} joiner={joiner} onUnfriend={askUnfriend} onFindUsers={() => setTab("find")} presenceStale={stale} />
        )}
        {tab === "requests" && (
          <PeopleList
            query={requests}
            context="requests"
            actions={actions}
            onUnfriend={askUnfriend}
            empty={<EmptyState title="No friend requests" hint="When someone sends you a request it will show up here." />}
          />
        )}
        {tab === "find" && <FindTab userId={userId} actions={actions} onUnfriend={askUnfriend} />}
      </motion.div>

      <ConfirmModal
        open={!!unfriend?.open}
        onClose={() => setUnfriend((u) => (u ? { ...u, open: false } : u))}
        onConfirm={() => unfriend && void actions.run(unfriend.user, "unfriend")}
        title="Remove friend?"
        message={`Remove ${unfriend?.user.displayName ?? "this user"} from your friends? You'll need to send a new request to become friends again.`}
        confirmLabel="Unfriend"
        danger
      />
    </>
  );
}

export default function Friends() {
  const session = useSocialSession();
  return (
    <Page>
      {session.userId !== null ? (
        <FriendsBody userId={session.userId} />
      ) : (
        <>
          <PageHeader title="Friends" subtitle="Your Roblox friends and requests" />
          <SignedOut loaded={session.loaded} expired={session.expired} />
        </>
      )}
    </Page>
  );
}
