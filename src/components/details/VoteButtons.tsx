import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatCompact } from "@/lib/format";
import type { VoteState } from "@/lib/gameExtras";
import { ipc } from "@/lib/ipc";
import type { AppError, GameDetails } from "@/lib/types";
import { useAccount } from "@/store/account";
import { toast } from "@/store/ui";
import { adjustVotes } from "@/lib/votes";
import { useWebSessionUserId } from "./session";

const REASONS: Record<string, string> = {
  PlayGame: "Play the game before voting on it",
};

function blockedHint(s: VoteState | undefined): string | undefined {
  if (!s || s.canVote) return undefined;
  return (s.reason && REASONS[s.reason]) || (s.reason ? `Voting isn't available (${s.reason})` : "Voting isn't available for this game");
}

interface Ctx {
  prevState: VoteState | undefined;
  prevGame: GameDetails | undefined;
}

/** Thumbs up / down with Roblox's live counts. Voting needs the Roblox web session; the UI updates optimistically. */
export function VoteButtons({ game }: { game: GameDetails }) {
  const qc = useQueryClient();
  const userId = useWebSessionUserId();
  const signIn = useAccount((s) => s.signIn);
  const universeId = game.universeId;
  const stateKey = ["voteState", userId, universeId] as const;
  const gameKey = ["game", game.placeId] as const;

  const state = useQuery<VoteState, AppError>({
    queryKey: stateKey,
    enabled: userId !== null && universeId > 0,
    staleTime: 60_000,
    retry: false,
    queryFn: () => ipc.gameVoteState(universeId),
  });

  const vote = useMutation<VoteState, AppError, boolean, Ctx>({
    mutationFn: (up) => ipc.gameVote(universeId, up),
    onMutate: async (up) => {
      await Promise.all([qc.cancelQueries({ queryKey: stateKey }), qc.cancelQueries({ queryKey: gameKey })]);
      const prevState = qc.getQueryData<VoteState>(stateKey);
      const prevGame = qc.getQueryData<GameDetails>(gameKey);
      qc.setQueryData<VoteState>(stateKey, { canVote: true, userVote: up, reason: null });
      if (prevGame && prevGame.upVotes !== undefined && prevGame.downVotes !== undefined) {
        const next = adjustVotes(prevGame.upVotes, prevGame.downVotes, prevState?.userVote ?? null, up);
        qc.setQueryData<GameDetails>(gameKey, { ...prevGame, upVotes: next.up, downVotes: next.down });
      }
      return { prevState, prevGame };
    },
    onError: (err, _up, ctx) => {
      if (ctx?.prevState) qc.setQueryData(stateKey, ctx.prevState);
      else void qc.invalidateQueries({ queryKey: stateKey });
      if (ctx?.prevGame) qc.setQueryData(gameKey, ctx.prevGame);
      toast.error(err.code === "auth_expired" ? "Your Roblox session expired — sign in again to vote." : err.message);
    },
    onSuccess: (result) => qc.setQueryData(stateKey, result),
  });

  const current = state.data?.userVote ?? null;
  const hint = userId === null ? "Sign in with Roblox to vote" : blockedHint(state.data);
  const locked = userId !== null && (state.isPending || state.data?.canVote === false || vote.isPending);

  const click = (up: boolean) => {
    if (userId === null) {
      void signIn();
      return;
    }
    if (locked || current === up) return;
    vote.mutate(up);
  };

  const btn = (up: boolean) => {
    const active = current === up;
    const count = up ? game.upVotes : game.downVotes;
    const Icon = up ? ThumbsUp : ThumbsDown;
    return (
      <button
        type="button"
        aria-pressed={active}
        aria-label={up ? "Vote up" : "Vote down"}
        title={hint ?? (active ? (up ? "You voted up" : "You voted down") : up ? "Vote up" : "Vote down")}
        disabled={locked && !active}
        onClick={() => click(up)}
        className={cn(
          "focus-ring inline-flex h-9 cursor-pointer items-center gap-2 rounded-full px-3.5 text-sm font-medium tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-50",
          active ? "accent-gradient text-white" : "bg-white/10 text-white hover:bg-white/18",
        )}
      >
        <Icon size={15} strokeWidth={active ? 2.25 : 1.75} fill={active ? "currentColor" : "none"} />
        {count !== undefined ? formatCompact(count) : "—"}
      </button>
    );
  };

  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Vote">
      {btn(true)}
      {btn(false)}
    </div>
  );
}
