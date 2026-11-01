import { useMemo, useState } from "react";
import { UserPlus } from "lucide-react";
import { SearchField } from "@/components/lists/SearchField";
import { Button } from "@/components/ui/Button";
import { EmptyState, StateSwitch } from "@/components/ui/StateSwitch";
import type { SocialUser } from "@/lib/socialTypes";
import { FriendCard, FriendRow } from "./FriendRows";
import { ViewToggle } from "@/components/lists/ViewToggle";
import { useSettings } from "@/store/settings";
import { PeopleSkeleton } from "./PeopleList";
import { matchesFriend, PRESENCE_GROUPS, sortFriends } from "./presence";
import { useFriendsList, type JoinFriend } from "./useFriends";

export function FriendsTab({
  userId,
  joiner,
  onUnfriend,
  onFindUsers,
  presenceStale,
}: {
  userId: number;
  joiner: JoinFriend;
  onUnfriend: (user: SocialUser) => void;
  onFindUsers: () => void;
  /** The background presence refresh is failing. */
  presenceStale: boolean;
}) {
  const query = useFriendsList(userId);
  const [filter, setFilter] = useState("");
  const view = useSettings((s) => s.values.friendsView);
  const setSetting = useSettings((s) => s.set);
  const data = query.data;

  const groups = useMemo(() => {
    const sorted = sortFriends((data?.friends ?? []).filter((f) => matchesFriend(f, filter)));
    return PRESENCE_GROUPS.map((g) => ({ ...g, friends: sorted.filter((f) => g.match(f.presence.status)) })).filter((g) => g.friends.length > 0);
  }, [data, filter]);

  const none = (data?.friends.length ?? 0) === 0;
  const noMatches = !none && groups.length === 0;

  return (
    <div className="flex flex-col gap-4">
      {!none && (
        <div className="flex items-center justify-between gap-3">
          <SearchField value={filter} onChange={setFilter} placeholder="Filter your friends" className="max-w-sm" />
          <ViewToggle value={view} onChange={(v) => void setSetting("friendsView", v)} />
        </div>
      )}
      {data?.presenceError && (
        <p role="status" className="rounded-card bg-danger/12 px-4 py-2.5 text-sm text-danger">
          Couldn't load who's online ({data.presenceError}). Everyone is shown as offline until the next refresh.
        </p>
      )}
      {presenceStale && !data?.presenceError && (
        <p role="status" className="rounded-card bg-white/6 px-4 py-2.5 text-sm text-muted">
          Live status is paused because the last refresh failed. Retrying automatically.
        </p>
      )}
      <StateSwitch
        loading={query.isPending}
        error={query.isError && !data ? query.error : null}
        onRetry={() => void query.refetch()}
        isEmpty={none || noMatches}
        skeleton={<PeopleSkeleton count={8} />}
        empty={
          noMatches ? (
            <EmptyState title={`No friends match “${filter.trim()}”`} hint="Check the spelling or clear the filter." />
          ) : (
            <EmptyState
              title="No friends yet"
              hint="Find people by name and send them a friend request."
              action={
                <Button variant="primary" icon={<UserPlus size={16} strokeWidth={1.75} />} onClick={onFindUsers}>
                  Find users
                </Button>
              }
            />
          )
        }
      >
        <div className="flex flex-col gap-5">
          {groups.map((g) => (
            <section key={g.id} aria-label={g.label}>
              <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
                {g.label} · {g.friends.length}
              </h2>
              <ul className={view === "grid" ? "grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-3" : "flex flex-col gap-2"}>
                {g.friends.map((f) =>
                  view === "grid" ? (
                    <FriendCard key={f.id} friend={f} joiner={joiner} onUnfriend={onUnfriend} />
                  ) : (
                    <FriendRow key={f.id} friend={f} joiner={joiner} onUnfriend={onUnfriend} />
                  ),
                )}
              </ul>
            </section>
          ))}
        </div>
      </StateSwitch>
    </div>
  );
}
