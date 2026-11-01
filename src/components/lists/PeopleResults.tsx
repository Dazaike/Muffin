import { BadgeCheck } from "lucide-react";
import { SmartImage } from "@/components/ui/SmartImage";
import { ipc, toAppError } from "@/lib/ipc";
import { useUserSearch } from "@/lib/roblox";
import { toast } from "@/store/ui";

/**
 * People matching the search text — display only (opens the profile on roblox.com). Hidden while loading,
 * when there are no matches, or when Roblox rejects the lookup: it's a bonus under the game results.
 */
export function PeopleResults({ query }: { query: string }) {
  const people = useUserSearch(query);
  const list = people.data ?? [];
  if (list.length === 0) return null;
  return (
    <section className="mt-8" aria-label="People">
      <h2 className="mb-3 text-lg font-semibold">People</h2>
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {list.map((u) => (
          <li key={u.id}>
            <button
              type="button"
              title="Open profile on roblox.com"
              onClick={() =>
                void ipc
                  .openExternal(`https://www.roblox.com/users/${u.id}/profile`)
                  .catch((e) => toast.error(toAppError(e).message))
              }
              className="focus-ring flex w-full cursor-pointer items-center gap-3 rounded-[12px] bg-white/4 p-2.5 text-left transition-colors hover:bg-white/8"
            >
              <SmartImage src={u.avatarUrl} name={u.displayName} className="size-11 shrink-0 rounded-full" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <span className="truncate">{u.displayName}</span>
                  {u.verified && <BadgeCheck size={14} strokeWidth={2} className="shrink-0 text-accent" />}
                </span>
                <span className="block truncate text-xs text-muted">@{u.name}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
