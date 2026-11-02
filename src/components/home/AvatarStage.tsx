import { lazy, Suspense, useState } from "react";
import { Skeleton } from "@/components/ui/Skeleton";
import { SmartImage } from "@/components/ui/SmartImage";
import { useAvatar3d } from "@/lib/avatar3d";
import { useMotionPrefs } from "@/lib/motion";
import { useHeadshot } from "@/lib/roblox";

const AvatarViewer = lazy(() => import("./AvatarViewer"));

/**
 * A user's avatar in 3D, filling its (relatively positioned) parent. Falls back to the headshot, with
 * the reason, when the 3D files can't be loaded or drawn.
 */
export function AvatarStage({ userId, name, fallbackSrc }: { userId: number | null; name?: string; fallbackSrc?: string | null }) {
  const m = useMotionPrefs();
  const avatar = useAvatar3d(userId);
  const headshot = useHeadshot(userId);
  const [broken, setBroken] = useState(false);

  if (avatar.data && !broken) {
    return (
      <Suspense fallback={<Skeleton className="absolute inset-3" />}>
        <AvatarViewer data={avatar.data} spin={!m.reduced && !m.off} onError={() => setBroken(true)} className="absolute inset-0" />
      </Suspense>
    );
  }
  if (avatar.isPending && userId !== null) return <Skeleton className="absolute inset-3" />;
  return (
    <div className="absolute inset-0 grid place-items-center">
      <SmartImage src={headshot.data ?? fallbackSrc} name={name} className="size-32 rounded-full" />
      <p className="absolute inset-x-4 top-3 text-center text-xs text-muted">
        {avatar.isError ? `3D avatar unavailable: ${avatar.error.message}` : "3D avatar couldn't be drawn"}
      </p>
    </div>
  );
}
