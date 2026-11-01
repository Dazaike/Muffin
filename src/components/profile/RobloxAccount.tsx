import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { LogOut, RefreshCw } from "lucide-react";
import { ViewToggle } from "@/components/lists/ViewToggle";
import { UserAvatar } from "@/components/shell/AccountMenu";
import { Button } from "@/components/ui/Button";
import { SmartImage } from "@/components/ui/SmartImage";
import { ipc } from "@/lib/ipc";
import type { AccountSection, AccountUser } from "@/lib/types";
import { useAccount } from "@/store/account";
import { useSettings } from "@/store/settings";

function AccountSectionView({ section, title, userId }: { section: AccountSection; title: string; userId: number }) {
  const query = useInfiniteQuery({
    queryKey: ["roblox-account", userId, section],
    queryFn: ({ pageParam }) => ipc.accountData(section, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor || undefined,
    staleTime: 0,
    retry: false,
  });
  const pages = query.data?.pages ?? [];
  const view = useSettings((s) => s.values.profileView);
  const setSetting = useSettings((s) => s.set);
  const items = pages.flatMap((page) => page.items);
  const balance = pages[0]?.robux;

  return (
    <section className="surface rounded-panel p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">{title}{section === "friends" && <Link to="/friends" className="focus-ring ml-3 rounded text-xs font-normal text-accent hover:underline">Manage friends &amp; requests</Link>}</h3>
        <div className="flex items-center gap-2">
          {section !== "robux" && items.length > 0 && <ViewToggle value={view} onChange={(v) => void setSetting("profileView", v)} />}
          <button type="button" aria-label={`Refresh ${title}`} disabled={query.isFetching} onClick={() => void query.refetch()} className="focus-ring rounded-full p-2 text-muted hover:bg-white/8 disabled:opacity-50"><RefreshCw size={16} /></button>
        </div>
      </div>
      {section === "saved" && <p className="mt-1 text-xs text-muted">Your favorited Roblox experiences, separate from your Muffin library.</p>}
      {query.isPending ? <p className="mt-3 text-sm text-muted">Loading {title.toLowerCase()}…</p> : query.isError && !query.data ? (
        <div className="mt-3 text-sm"><p className="text-danger">{query.error.message || `Couldn't load ${title.toLowerCase()}.`}</p><Button variant="glass" size="sm" onClick={() => void query.refetch()}>Retry</Button></div>
      ) : section === "robux" ? (
        <p className="mt-3 text-2xl font-semibold tabular-nums">{balance == null ? "Balance unavailable" : `${balance.toLocaleString()} Robux`}</p>
      ) : items.length === 0 ? (
        <p className="mt-3 text-sm text-muted">No {title.toLowerCase()} to show.</p>
      ) : (
        <div className={view === "grid" ? "mt-3 grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-2" : "mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2"}>
          {items.map((item) => {
            const label = item.displayName || item.name;
            const handle = item.displayName && item.displayName !== item.name ? `@${item.name}` : null;
            const contents =
              view === "grid" ? (
                <>
                  <SmartImage src={item.iconUrl ?? undefined} name={label} className="size-20 shrink-0 rounded-xl" />
                  <span className="w-full min-w-0 text-center"><span className="block truncate font-medium">{label}</span>{handle && <span className="block truncate text-xs text-muted">{handle}</span>}</span>
                </>
              ) : (
                <><SmartImage src={item.iconUrl ?? undefined} name={label} className="size-12 shrink-0 rounded-xl" /><span className="min-w-0"><span className="block truncate font-medium">{label}</span>{handle && <span className="block truncate text-xs text-muted">{handle}</span>}</span></>
              );
            const cls = view === "grid" ? "flex min-w-0 flex-col items-center gap-2 rounded-xl bg-white/4 p-3 text-sm" : "flex min-w-0 items-center gap-3 rounded-xl bg-white/4 p-2 text-sm";
            return item.placeId && section !== "friends" ? <Link key={item.id} to={`/game/${item.placeId}`} className={`${cls} focus-ring hover:bg-white/8`}>{contents}</Link> : <div key={item.id} className={cls}>{contents}</div>;
          })}
        </div>
      )}
      {query.isRefetchError && !query.isFetchNextPageError && <p className="mt-3 text-sm text-danger">Couldn't refresh: {query.error.message}</p>}
      {query.isFetchNextPageError && <p className="mt-3 text-sm text-danger">{query.error.message || "Couldn't load more."}</p>}
      {query.hasNextPage && <Button variant="glass" size="sm" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{query.isFetchingNextPage ? "Loading…" : query.isFetchNextPageError ? "Retry loading more" : "Load more"}</Button>}
    </section>
  );
}

export function RobloxAccount({ user }: { user: AccountUser }) {
  const signOut = useAccount((s) => s.signOut);
  return (
    <>
      <section className="glass rounded-hero p-6 md:p-8">
        <div className="flex flex-wrap items-center gap-5">
          <UserAvatar user={{ ...user, id: String(user.id) }} size={80} />
          <div className="min-w-0 flex-1"><h2 className="truncate text-2xl font-semibold">{user.displayName}</h2><p className="text-sm text-muted">@{user.username} · ID {user.id}</p><p className="mt-2 text-sm text-muted">Signed in inside Muffin</p></div>
          <Button variant="glass" icon={<LogOut size={16} />} onClick={() => void signOut()}>Sign out</Button>
        </div>
      </section>
      <AccountSectionView section="robux" title="Robux" userId={user.id} />
      <AccountSectionView section="friends" title="Friends" userId={user.id} />
      <AccountSectionView section="created" title="Created games" userId={user.id} />
      <AccountSectionView section="saved" title="Saved games" userId={user.id} />
    </>
  );
}
