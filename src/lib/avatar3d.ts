import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { ipc } from "./ipc";
import type { AppError } from "./types";

/** Mirrors `src-tauri/src/avatar3d.rs`. */
export interface Avatar3d {
  obj: string;
  mtl: string;
  /** `name` is the file name the MTL refers to. */
  textures: { name: string; dataUrl: string }[];
  /** Roblox's suggested camera and bounding box (`{x,y,z}` vectors), passed through untouched. */
  camera: unknown;
  aabb: unknown;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** `{x,y,z}` with finite numbers, else `undefined`: Roblox's metadata is passed through unvalidated. */
export function toVec3(v: unknown): Vec3 | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const { x, y, z } = v as Record<string, unknown>;
  return [x, y, z].every((n) => typeof n === "number" && Number.isFinite(n)) ? { x: x as number, y: y as number, z: z as number } : undefined;
}

/** The signed-in user's 3D avatar files. Heavy (mesh + textures), so cached for a while. */
export function useAvatar3d(userId: number | null): UseQueryResult<Avatar3d, AppError> {
  return useQuery<Avatar3d, AppError>({
    queryKey: ["avatar3d", userId],
    enabled: userId !== null,
    staleTime: 30 * 60_000,
    gcTime: 30 * 60_000,
    retry: false,
    queryFn: () => ipc.avatar3d(userId as number),
  });
}
