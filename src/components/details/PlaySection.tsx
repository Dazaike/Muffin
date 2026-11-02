import { BadgeCheck, Copy, Ellipsis, ExternalLink } from "lucide-react";
import { FavoriteButton } from "@/components/game/FavoriteButton";
import { PlayButton } from "@/components/game/PlayButton";
import { BellButton } from "@/components/ui/BellButton";
import { Menu } from "@/components/ui/Menu";
import { SmartImage } from "@/components/ui/SmartImage";
import { formatDuration } from "@/lib/format";
import { usePlayedMs } from "@/lib/playtime";
import { useWatch } from "@/lib/watch";
import type { GameDetails, GameRef } from "@/lib/types";
import { HeroPicture } from "./HeroPicture";
import { copyText, gamePageUrl, openLink } from "./links";
import { RecommendedStrip } from "./RecommendedStrip";
import { RatingBar, StatsRow } from "./StatsRow";
import { SocialLinks } from "./SocialLinks";
import { VoteButtons } from "./VoteButtons";
import { Description } from "./Description";

const TILE = "focus-ring glass inline-flex size-13 shrink-0 cursor-pointer items-center justify-center rounded-[14px]";

interface PlaySectionProps {
  game: GameDetails;
  gameRef: GameRef;
  loading: boolean;
  /** Jump to another section of the page (Details, Community). */
  go: (section: "community") => void;
}

/** The overview: identity, Play and quick actions, a short description and stats on the left, the big picture on the right. */
export function PlaySection({ game, gameRef, loading, go }: PlaySectionProps) {
  const playedMs = usePlayedMs(game.placeId);
  const watch = useWatch();
  const chip = "rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-medium text-fg";

  return (
    <div className="flex flex-col gap-8">
      <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <div className="flex items-start gap-5">
            <SmartImage
              fade={false}
              src={game.iconUrl}
              name={game.name}
              className="size-32 shrink-0 rounded-[22px] shadow-[0_12px_32px_-8px_#000c] md:size-36"
            />
            <div className="flex min-w-0 flex-col gap-2.5">
              {game.creator ? (
                <button
                  type="button"
                  onClick={() => go("community")}
                  className="focus-ring inline-flex w-fit cursor-pointer items-center gap-1 rounded text-sm text-muted hover:text-fg hover:underline"
                >
                  by {game.creator}
                  {game.creatorVerified && <BadgeCheck size={15} strokeWidth={2} aria-label="Verified" />}
                </button>
              ) : loading ? (
                <span className="skeleton h-4 w-24 rounded" />
              ) : null}
              <div className="flex flex-wrap gap-1.5">
                {game.creatorType && <span className={chip}>{game.creatorType === "Group" ? "Group" : "User"}</span>}
                {game.genre && <span className={chip}>{game.genre}</span>}
                {playedMs !== undefined && playedMs > 0 && <span className={chip}>You played {formatDuration(playedMs)}</span>}
              </div>
              <h1 className="text-3xl leading-tight font-semibold tracking-tight md:text-4xl">{game.name}</h1>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <PlayButton game={gameRef} size="lg" className="h-13 flex-1" />
            <FavoriteButton game={gameRef} tile />
            {!loading && game.universeId > 0 && (
              <BellButton
                variant="icon"
                size="tile"
                label={`Notify me when ${game.name} is updated`}
                subscribed={watch.isWatching("game", game.universeId)}
                onSubscribedChange={(on) => void watch.toggle("game", game.universeId, on)}
              />
            )}
            <button type="button" aria-label="Open on roblox.com" title="Open on roblox.com" onClick={() => openLink(gamePageUrl(gameRef.placeId))} className={TILE}>
              <ExternalLink size={18} strokeWidth={1.75} />
            </button>
            <Menu
              entries={[
                { label: "Copy link", icon: <Copy size={16} strokeWidth={1.75} />, onSelect: () => void copyText(gamePageUrl(gameRef.placeId), "Link copied") },
              ]}
              trigger={(props) => (
                <button type="button" aria-label="More" title="More" className={TILE} {...props}>
                  <Ellipsis size={18} strokeWidth={1.75} />
                </button>
              )}
            />
          </div>

          <StatsRow game={game} loading={loading} className="grid-cols-2 sm:grid-cols-3" />
          {game.upVotes !== undefined && game.downVotes !== undefined && <RatingBar up={game.upVotes} down={game.downVotes} />}
          {!loading && game.universeId > 0 && <VoteButtons game={game} />}
          {game.universeId > 0 && <SocialLinks universeId={game.universeId} />}
        </div>

        <div className="flex min-w-0 flex-col gap-8">
          <HeroPicture game={game} />
          <Description text={game.description} loading={loading} />
        </div>
      </div>
      {!loading && <RecommendedStrip universeId={game.universeId > 0 ? game.universeId : null} />}
    </div>
  );
}
