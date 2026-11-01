import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import type { SocialLink } from "@/lib/gameExtras";
import { ipc, toAppError } from "@/lib/ipc";
import type { AppError } from "@/lib/types";
import { toast } from "@/store/ui";
import { useWebSessionUserId } from "./session";

/**
 * Developer-provided social links. Roblox only lists them to signed-in users, so guests see nothing
 * (the section stays hidden rather than nagging). Links open through the Rust opener, which only
 * accepts https URLs on a short list of hosts.
 */
export function SocialLinks({ universeId }: { universeId: number }) {
  const userId = useWebSessionUserId();
  const links = useQuery<SocialLink[], AppError>({
    queryKey: ["socialLinks", userId, universeId],
    enabled: userId !== null && universeId > 0,
    staleTime: 10 * 60_000,
    retry: false,
    queryFn: () => ipc.gameSocialLinks(universeId),
  });
  const items = links.data ?? [];
  if (items.length === 0) return null;
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">Links</h2>
      <div className="flex flex-wrap gap-2">
        {items.map((l) => (
          <button
            key={l.url}
            type="button"
            title={l.url}
            onClick={() => void ipc.openExternal(l.url).catch((e) => toast.error(toAppError(e).message))}
            className="focus-ring glass inline-flex h-9 cursor-pointer items-center gap-2 rounded-full px-3.5 text-sm transition-colors hover:bg-white/10"
          >
            <ExternalLink size={14} strokeWidth={1.75} className="text-muted" />
            <span className="max-w-48 truncate">{l.title}</span>
            {l.title !== l.kind && <span className="text-xs text-muted">{l.kind}</span>}
          </button>
        ))}
      </div>
    </section>
  );
}
