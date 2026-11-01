import { useCallback, useMemo, useState } from "react";
import { Sparkles, WifiOff } from "lucide-react";
import { GameCard } from "@/components/game/GameCard";
import { Carousel, CarouselItem } from "@/components/home/Carousel";
import { FeaturedHero } from "@/components/home/FeaturedHero";
import { InfiniteSentinel } from "@/components/lists/InfiniteSentinel";
import { Section } from "@/components/home/Section";
import { Button } from "@/components/ui/Button";
import { Page } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { relativeTime } from "@/lib/format";
import { mergeContinue } from "@/lib/continueMerge";
import { recommend } from "@/lib/recommend";
import { useRobloxContinue, useSortGames } from "@/lib/roblox";
import type { GameSummary } from "@/lib/types";
import { useLibrary } from "@/store/library";

const POSTER_W = "calc(var(--poster-min) * 1.1)";

const HERO_COUNT = 5;
const TRENDING_COUNT = 10;
const UP_AND_COMING_COUNT = 6;
const REC_BATCH = 12;

function CarouselSkeleton({ count, width, height }: { count: number; width: string; height: string }) {
  return (
    <div className="flex gap-[var(--card-gap)] overflow-hidden">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="shrink-0" style={{ width, height }} />
      ))}
    </div>
  );
}

export default function Home() {
  const trending = useSortGames("top-trending");
  const playingNow = useSortGames("top-playing-now");
  const upAndComing = useSortGames("up-and-coming");

  const entries = useLibrary((s) => s.entries);
  const history = useLibrary((s) => s.history);
  const hydrated = useLibrary((s) => s.hydrated);

  const trendingGames = trending.data;
  const heroGames = useMemo(() => trendingGames?.slice(0, HERO_COUNT) ?? [], [trendingGames]);
  const trendingTop = useMemo(() => trendingGames?.slice(0, TRENDING_COUNT) ?? [], [trendingGames]);
  const upGames = useMemo(() => upAndComing.data?.slice(0, UP_AND_COMING_COUNT) ?? [], [upAndComing.data]);

  const favorites = useMemo(() => entries.filter((e) => e.favorite), [entries]);
  const robloxContinue = useRobloxContinue();
  const continuePlaying = useMemo(() => mergeContinue(history, robloxContinue.data), [history, robloxContinue.data]);
  const hasRobloxItems = continuePlaying.some((c) => c.onRoblox);

  const pool = useMemo(() => {
    const seen = new Set<number>();
    const out: GameSummary[] = [];
    for (const list of [trending.data, playingNow.data, upAndComing.data]) {
      for (const g of list ?? []) {
        if (seen.has(g.placeId)) continue;
        seen.add(g.placeId);
        out.push(g);
      }
    }
    return out;
  }, [trending.data, playingNow.data, upAndComing.data]);
  const recommended = useMemo(() => recommend(pool, entries, history, Infinity, true), [pool, entries, history]);
  const [recCount, setRecCount] = useState(REC_BATCH);
  const showMore = useCallback(() => setRecCount((n) => n + REC_BATCH), []);
  const hasSignal = useMemo(
    () => entries.some((e) => e.genre) || history.some((h) => h.genre),
    [entries, history],
  );

  const now = Date.now();
  const libraryEmpty = entries.length === 0 && history.length === 0;
  const liveFailed = trending.isError && !trending.isPending;

  return (
    <Page className="pt-5">
      {/* 1. Featured hero */}
      {trending.isPending && <Skeleton className="min-h-[400px] rounded-hero md:min-h-[460px]" />}
      {heroGames.length > 0 && <FeaturedHero games={heroGames} />}
      {liveFailed && (
        <div className="surface flex flex-wrap items-center justify-between gap-3 rounded-card px-4 py-3">
          <div className="flex items-center gap-3 text-sm text-muted">
            <WifiOff size={18} strokeWidth={1.75} />
            <span>Live games couldn't be loaded{trending.error ? ` — ${trending.error.message}` : ""}.</span>
          </div>
          <Button variant="glass" size="sm" onClick={() => void trending.refetch()}>
            Retry
          </Button>
        </div>
      )}

      {/* 2. Continue Playing */}
      {continuePlaying.length > 0 && (
        <Section index={1} title="Continue Playing" caption={hasRobloxItems ? "Your launches from Muffin, then your Roblox Continue row" : undefined}>
          <Carousel label="Continue Playing">
            {continuePlaying.map((c, i) => (
              <CarouselItem key={c.game.placeId} width={POSTER_W}>
                <GameCard
                  game={c.game}
                  variant="poster"
                  index={i}
                  subtitle={c.lastLaunchedAt !== undefined ? `Launched ${relativeTime(c.lastLaunchedAt, now)}` : "On Roblox"}
                />
              </CarouselItem>
            ))}
          </Carousel>
        </Section>
      )}
      {continuePlaying.length === 0 && hydrated && libraryEmpty && (
        <Section index={1} title="Continue Playing">
          <div className="surface flex items-center gap-3 rounded-card px-5 py-4 text-sm text-muted">
            <Sparkles size={18} strokeWidth={1.75} className="shrink-0 text-accent" />
            Your launches will appear here
          </div>
        </Section>
      )}

      {/* 4. Your Favorites */}
      {favorites.length > 0 && (
        <Section index={3} title="Your Favorites">
          <Carousel label="Your Favorites">
            {favorites.map((f, i) => (
              <CarouselItem key={f.placeId} width={POSTER_W}>
                <GameCard game={f} variant="poster" index={i} />
              </CarouselItem>
            ))}
          </Carousel>
        </Section>
      )}

      {/* 5. Trending Games */}
      {trending.isPending && (
        <Section index={4} title="Trending Games">
          <CarouselSkeleton count={6} width={POSTER_W} height="260px" />
        </Section>
      )}
      {trendingTop.length > 0 && (
        <Section index={4} title="Trending Games">
          <Carousel label="Trending Games">
            {trendingTop.map((g, i) => (
              <CarouselItem key={g.placeId} width={POSTER_W}>
                <GameCard game={g} variant="poster" index={i} />
              </CarouselItem>
            ))}
          </Carousel>
        </Section>
      )}

      {/* 6. Recommended for you */}
      {hasSignal && recommended.length > 0 && (
        <Section index={5} title="Recommended for you" caption="Based on genres of your favorites and recent launches">
          <div className="grid gap-x-[var(--card-gap)] gap-y-8" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(var(--poster-min), 1fr))" }}>
            {recommended.slice(0, recCount).map((g, i) => (
              <GameCard key={g.placeId} game={g} variant="poster" index={i} />
            ))}
          </div>
          {recCount < recommended.length && <InfiniteSentinel onVisible={showMore} />}
        </Section>
      )}
      {!hasSignal && hydrated && !liveFailed && (
        <Section index={5} title="Recommended for you" caption="Favorite or play a few games to get suggestions" />
      )}
      {recommended.length === 0 && hasSignal && pool.length === 0 && (trending.isPending || playingNow.isPending || upAndComing.isPending) && (
        <Section index={5} title="Recommended for you" caption="Based on genres of your favorites and recent launches">
          <CarouselSkeleton count={6} width={POSTER_W} height="260px" />
        </Section>
      )}

      {/* 7. Up-and-Coming */}
      {upAndComing.isPending && (
        <Section index={6} title="Up-and-Coming">
          <div className="grid gap-[var(--card-gap)]" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-[84px]" />
            ))}
          </div>
        </Section>
      )}
      {upGames.length > 0 && (
        <Section index={6} title="Up-and-Coming">
          <div className="grid gap-[var(--card-gap)]" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
            {upGames.map((g, i) => (
              <GameCard key={g.placeId} game={g} variant="row" index={i} />
            ))}
          </div>
        </Section>
      )}
    </Page>
  );
}
