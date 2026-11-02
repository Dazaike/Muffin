import { useMemo } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, BadgeCheck, ExternalLink } from "lucide-react";
import { presenceText } from "@/components/friends/presence";
import { useFriendsList, useJoinFriend, useSocialSession } from "@/components/friends/useFriends";
import { JoinPill } from "@/components/friends/FriendRows";
import type { UserRouteState } from "@/components/friends/UserLink";
import { navigateBackToUserWithMorph, USER_VT_ATTR, USER_VT_NAME } from "@/lib/gameTransition";
import { useMotionPrefs } from "@/lib/motion";
import { ProfileTabs } from "@/components/profile/ProfileTabs";
import { AvatarStage } from "@/components/home/AvatarStage";
import { BellButton } from "@/components/ui/BellButton";
import { Button } from "@/components/ui/Button";
import { Page } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { SmartImage } from "@/components/ui/SmartImage";
import { toAppError, ipc } from "@/lib/ipc";
import { formatCompact, formatDate } from "@/lib/format";
import { useHeadshot } from "@/lib/roblox";
import { useUserProfile } from "@/lib/userProfile";
import { useWatch } from "@/lib/watch";
import type { CardGame } from "@/lib/types";
import { toast } from "@/store/ui";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="surface rounded-card px-4 py-3">
      <div className="text-[11px] font-medium tracking-wide text-muted uppercase">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}

const count = (n: number | null | undefined) => (n === null || n === undefined ? "—" : formatCompact(n));

export default function UserProfile() {
  const navigate = useNavigate();
  const routeState = useLocation().state as UserRouteState | null;
  const seedAvatar = routeState?.avatarUrl;
  const m = useMotionPrefs();
  const params = useParams();
  const parsed = Number(params.userId);
  const userId = Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;

  const profile = useUserProfile(userId);
  const headshot = useHeadshot(userId);
  const { userId: me } = useSocialSession();
  const friends = useFriendsList(me);
  const { joining, join } = useJoinFriend(me);
  const watch = useWatch();
  const friend = useMemo(() => friends.data?.friends.find((f) => f.id === userId), [friends.data, userId]);

  const games: CardGame[] = useMemo(
    () => (profile.data?.games ?? []).map((g) => ({ placeId: g.placeId, universeId: g.universeId, name: g.name })),
    [profile.data],
  );

  const p = profile.data;
  const presence = friend?.presence;

  return (
    <Page className="pt-5">
      <Button variant="glass" size="sm" icon={<ArrowLeft size={16} strokeWidth={1.75} />} onClick={() => (userId !== null && routeState?.fromAvatar ? navigateBackToUserWithMorph(userId, () => navigate(-1), !m.off) : navigate(-1))} className="mb-4">
        Back
      </Button>

      {userId === null && <div className="text-sm text-danger">That isn't a valid user.</div>}
      {profile.isError && <div className="text-sm text-danger">Couldn't load this profile: {profile.error.message}</div>}

      {userId !== null && !profile.isError && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]">
          <div className="surface relative h-[420px] overflow-hidden rounded-card bg-[radial-gradient(ellipse_at_50%_100%,rgba(255,255,255,0.07),transparent_70%)]">
            <AvatarStage userId={userId} name={p?.displayName} fallbackSrc={friend?.avatarUrl} />
          </div>

          <div className="flex min-w-0 flex-col gap-5">
            <div className="flex items-start gap-4">
              {/* Always present (even while the profile loads) so the list avatar has somewhere to land. */}
              <div {...{ [USER_VT_ATTR]: "" }} style={{ viewTransitionName: USER_VT_NAME }} className="size-20 shrink-0 overflow-hidden rounded-full">
                <SmartImage src={seedAvatar ?? headshot.data ?? friend?.avatarUrl} name={p?.displayName} className="size-full" />
              </div>
              {!p ? (
                <Skeleton className="h-20 flex-1" />
              ) : (
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h1 className="truncate text-[28px] leading-tight font-semibold tracking-tight">{p.displayName}</h1>
                    {p.verified && <BadgeCheck size={20} strokeWidth={1.75} className="shrink-0 text-accent" aria-label="Verified" />}
                  </div>
                  <div className="text-sm text-muted">@{p.name}</div>
                  {p.banned && <div className="mt-1 text-sm text-danger">This account is banned.</div>}
                  {presence && <div className="mt-1.5 text-sm text-muted">{presenceText(presence)}</div>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {presence?.status === "inGame" && (
                      <JoinPill
                        joining={joining === p.id}
                        disabled={!presence.joinable || (joining !== null && joining !== p.id)}
                        title={presence.joinable ? undefined : "Roblox doesn't share which server they're in"}
                        onJoin={() => (friend ? join(friend) : undefined)}
                      />
                    )}
                    <Button
                      variant="glass"
                      size="sm"
                      icon={<ExternalLink size={16} strokeWidth={1.75} />}
                      onClick={() => void ipc.openExternal(`https://www.roblox.com/users/${p.id}/profile`).catch((e) => toast.error(toAppError(e).message))}
                    >
                      Open on Roblox
                    </Button>
                    {friend && (
                      <BellButton
                        variant="icon"
                        size="sm"
                        label={`Notify me when ${p.displayName} comes online`}
                        subscribed={watch.isWatching("friend", p.id)}
                        onSubscribedChange={(on) => void watch.toggle("friend", p.id, on)}
                      />
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Friends" value={count(p?.friends)} />
              <Stat label="Followers" value={count(p?.followers)} />
              <Stat label="Following" value={count(p?.following)} />
              <Stat label="Joined" value={formatDate(p?.created) ?? "—"} />
            </div>

            <section className="surface rounded-panel p-5">
              <h2 className="text-base font-semibold">About</h2>
              <p className="mt-2 text-sm leading-relaxed break-words whitespace-pre-wrap text-muted">
                {p ? p.description.trim() || "No description." : "Loading…"}
              </p>
            </section>
          </div>
        </div>
      )}

      {userId !== null && !profile.isError && <ProfileTabs userId={userId} games={games} />}
    </Page>
  );
}
