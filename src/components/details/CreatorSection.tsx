import { BadgeCheck, ExternalLink, Users } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SmartImage } from "@/components/ui/SmartImage";
import { formatCompact } from "@/lib/format";
import { useCreatorGroup, useHeadshot } from "@/lib/roblox";
import type { GameDetails } from "@/lib/types";
import { openLink } from "./links";

export const CREATOR_SECTION_ID = "game-creator";

function Verified() {
  return (
    <span title="Verified" aria-label="Verified" className="inline-flex shrink-0 text-accent">
      <BadgeCheck size={18} strokeWidth={2} />
    </span>
  );
}

/**
 * Who made the experience: avatar / group icon, name with verified badge, user-or-group type and, for groups,
 * the member count and owner from `groups.roblox.com`. Hidden until the real details name a creator.
 */
export function CreatorSection({ game }: { game: GameDetails }) {
  const isGroup = game.creatorType === "Group";
  const id = game.creatorId ?? null;
  const group = useCreatorGroup(isGroup ? id : null);
  const headshot = useHeadshot(!isGroup ? id : null);
  if (!game.creator || id === null || !game.creatorType) return null;

  const name = group.data?.name ?? game.creator;
  const verified = isGroup ? (group.data?.verified ?? game.creatorVerified) : game.creatorVerified;
  const avatar = isGroup ? group.data?.iconUrl : headshot.data;
  const profileUrl = isGroup ? `https://www.roblox.com/communities/${id}` : `https://www.roblox.com/users/${id}/profile`;

  return (
    <section id={CREATOR_SECTION_ID} aria-label="Creator" className="surface flex flex-wrap items-center gap-4 rounded-card p-4">
      <SmartImage
        fade={false}
        src={avatar}
        name={name}
        className={isGroup ? "size-16 shrink-0 rounded-[14px]" : "size-16 shrink-0 rounded-full"}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="text-[11px] font-medium tracking-wide text-muted uppercase">Creator</div>
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-lg font-semibold">{name}</span>
          {verified && <Verified />}
          <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-xs font-medium">
            {isGroup ? "Group" : "User"}
          </span>
        </div>
        {isGroup && group.data && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-sm text-muted">
            {group.data.memberCount !== null && (
              <span
                className="inline-flex items-center gap-1.5 tabular-nums"
                title={`${group.data.memberCount.toLocaleString("en-US")} members`}
              >
                <Users size={14} strokeWidth={1.75} />
                {formatCompact(group.data.memberCount)} members
              </span>
            )}
            {group.data.ownerName && <span>Owner: {group.data.ownerName}</span>}
          </div>
        )}
      </div>
      <Button
        variant="glass"
        size="sm"
        icon={<ExternalLink size={14} strokeWidth={1.75} />}
        onClick={() => openLink(profileUrl)}
      >
        {isGroup ? "View group" : "View profile"}
      </Button>
    </section>
  );
}
