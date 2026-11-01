import type { ReactNode } from "react";
import { LogIn } from "lucide-react";
import type { InfiniteData, UseInfiniteQueryResult } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import type { Paged } from "@/lib/gameExtras";
import type { AppError } from "@/lib/types";
import { useAccount } from "@/store/account";

/** Flattened items of an infinite query of `Paged<T>` pages. */
export function flatItems<T>(data: InfiniteData<Paged<T>> | undefined): T[] {
  return data ? data.pages.flatMap((p) => p.items) : [];
}

export function ListSkeleton({ rows = 4, height = "h-16" }: { rows?: number; height?: string }) {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={`skeleton rounded-[12px] ${height}`} />
      ))}
    </div>
  );
}

/** "Load more" for an infinite query; shows the failure (and a retry) when the next page fails. */
export function LoadMore<T>({ query }: { query: UseInfiniteQueryResult<InfiniteData<Paged<T>>, AppError> }) {
  if (!query.hasNextPage && !query.isFetchNextPageError) return null;
  return (
    <div className="mt-3 flex flex-col items-center gap-2">
      {query.isFetchNextPageError && <p className="text-sm text-danger">{query.error?.message || "Couldn't load more."}</p>}
      <Button variant="glass" size="sm" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
        {query.isFetchingNextPage ? "Loading…" : query.isFetchNextPageError ? "Retry" : "Load more"}
      </Button>
    </div>
  );
}

/** Prompt shown where a feature needs the Roblox web session. */
export function SignInNote({ children }: { children: ReactNode }) {
  const signIn = useAccount((s) => s.signIn);
  const signingIn = useAccount((s) => s.signingIn);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] bg-white/4 px-3.5 py-2.5 text-sm text-muted">
      <span>{children}</span>
      <Button
        size="sm"
        variant="glass"
        icon={<LogIn size={15} strokeWidth={1.75} />}
        disabled={signingIn}
        onClick={() => void signIn()}
      >
        {signingIn ? "Waiting for Roblox…" : "Sign in with Roblox"}
      </Button>
    </div>
  );
}
