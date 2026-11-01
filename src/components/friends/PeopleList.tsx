import { useMemo, type ReactNode } from "react";
import type { UseInfiniteQueryResult } from "@tanstack/react-query";
import { ViewToggle } from "@/components/lists/ViewToggle";
import { Button } from "@/components/ui/Button";
import { StateSwitch } from "@/components/ui/StateSwitch";
import type { PersonPage, PersonRow, SocialUser } from "@/lib/socialTypes";
import type { AppError } from "@/lib/types";
import { useSettings } from "@/store/settings";
import { PersonCard, PersonRowView, type PersonContext } from "./FriendRows";
import type { FriendActions } from "./useFriends";

export function PeopleSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton h-[72px] w-full rounded-card" aria-hidden />
      ))}
    </div>
  );
}

/** Paged list of people (requests / followers / following / search results) with every state handled. */
export function PeopleList({
  query,
  context,
  actions,
  onUnfriend,
  empty,
}: {
  query: UseInfiniteQueryResult<{ pages: PersonPage[]; pageParams: (string | null)[] }, AppError>;
  context: PersonContext;
  actions: FriendActions;
  onUnfriend: (user: SocialUser) => void;
  empty: ReactNode;
}) {
  const view = useSettings((s) => s.values.peopleView);
  const setSetting = useSettings((s) => s.set);
  const items = useMemo(() => {
    const seen = new Set<number>();
    const out: PersonRow[] = [];
    for (const page of query.data?.pages ?? []) {
      for (const p of page.items) {
        if (!seen.has(p.id)) {
          seen.add(p.id);
          out.push(p);
        }
      }
    }
    return out;
  }, [query.data]);

  return (
    <StateSwitch
      loading={query.isPending}
      error={query.isError && !query.data ? query.error : null}
      onRetry={() => void query.refetch()}
      isEmpty={items.length === 0 && !query.hasNextPage}
      skeleton={<PeopleSkeleton />}
      empty={empty}
    >
      <div className="mb-3 flex justify-end">
        <ViewToggle value={view} onChange={(v) => void setSetting("peopleView", v)} />
      </div>
      <ul className={view === "grid" ? "grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3" : "flex flex-col gap-2"}>
        {items.map((p) =>
          view === "grid" ? (
            <PersonCard key={p.id} person={p} context={context} actions={actions} onUnfriend={onUnfriend} />
          ) : (
            <PersonRowView key={p.id} person={p} context={context} actions={actions} onUnfriend={onUnfriend} />
          ),
        )}
      </ul>
      {query.isRefetchError && !query.isFetchNextPageError && (
        <p className="mt-3 text-sm text-danger">Couldn't refresh: {query.error?.message}</p>
      )}
      {query.isFetchNextPageError && <p className="mt-3 text-sm text-danger">{query.error?.message || "Couldn't load more."}</p>}
      {query.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button variant="glass" size="sm" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
            {query.isFetchingNextPage ? "Loading…" : query.isFetchNextPageError ? "Retry loading more" : "Load more"}
          </Button>
        </div>
      )}
    </StateSwitch>
  );
}
