import { useMemo } from "react";
import { useLocation, useParams } from "react-router-dom";
import { ArrowLeft, TriangleAlert } from "lucide-react";
import { CreatorSection } from "@/components/details/CreatorSection";
import { DetailsHero } from "@/components/details/DetailsHero";
import { DetailsTabs } from "@/components/details/DetailsTabs";
import { RecommendedStrip } from "@/components/details/RecommendedStrip";
import { RatingBar, StatsRow } from "@/components/details/StatsRow";
import { Button } from "@/components/ui/Button";
import { Page } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState, ErrorState } from "@/components/ui/StateSwitch";
import { useGoBack } from "@/hooks/useGoBack";
import { toGameRef } from "@/lib/launch";
import { parsePlaceIdParam, type GameRouteState } from "@/lib/links";
import { useGameDetails } from "@/lib/roblox";
import type { GameSummary } from "@/lib/types";

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <Button variant="glass" icon={<ArrowLeft size={16} strokeWidth={1.75} />} onClick={onBack}>
      Back
    </Button>
  );
}

function DetailsSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-hidden>
      <Skeleton className="h-[340px] rounded-hero md:h-[420px]" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-[76px]" />
        ))}
      </div>
    </div>
  );
}

export default function GameDetails() {
  const { placeId: param } = useParams();
  const placeId = parsePlaceIdParam(param);
  const goBack = useGoBack();
  const routeState = useLocation().state as GameRouteState | null;

  // Instant paint from the card the user clicked; ignored when it belongs to another place.
  const seed = useMemo<Partial<GameSummary> | undefined>(() => {
    const s = routeState?.seed;
    if (!s || s.placeId !== placeId) return undefined;
    return {
      placeId: s.placeId,
      universeId: s.universeId ?? undefined,
      name: s.name,
      iconUrl: s.iconUrl ?? undefined,
      playerCount: s.playerCount,
      genre: s.genre ?? undefined,
      upVotes: s.upVotes,
      downVotes: s.downVotes,
      description: s.description,
      creator: s.creator ?? undefined,
    };
  }, [routeState, placeId]);

  const query = useGameDetails(placeId, seed);
  const game = query.data;

  if (placeId === null) {
    return (
      <Page className="pt-6">
        <EmptyState
          icon={<TriangleAlert size={22} strokeWidth={1.75} />}
          title="Invalid game id"
          hint="This link doesn't point to a Roblox experience."
          action={<BackButton onBack={goBack} />}
        />
      </Page>
    );
  }

  if (!game) {
    return (
      <Page className="pt-6">
        {query.isError ? (
          <div className="flex flex-col items-center gap-2">
            <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />
            <BackButton onBack={goBack} />
          </div>
        ) : (
          <DetailsSkeleton />
        )}
      </Page>
    );
  }

  const gameRef = toGameRef({
    placeId,
    universeId: game.universeId || null,
    name: game.name,
    iconUrl: game.iconUrl ?? null,
    genre: game.genre ?? null,
    creator: game.creator || null,
  });
  const seedOnly = query.isPlaceholderData;

  return (
    <Page className="pt-6">
      <div className="flex flex-col gap-6">
        <DetailsHero game={game} gameRef={gameRef} loading={seedOnly} onBack={goBack} />
        <StatsRow game={game} loading={seedOnly} />
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <DetailsTabs game={game} gameRef={gameRef} loading={seedOnly} />
          <aside className="flex flex-col gap-4 lg:order-last">
            {game.upVotes !== undefined && game.downVotes !== undefined && <RatingBar up={game.upVotes} down={game.downVotes} />}
            <CreatorSection game={game} />
          </aside>
        </div>
        {!seedOnly && <RecommendedStrip universeId={game.universeId > 0 ? game.universeId : null} />}
      </div>
    </Page>
  );
}
