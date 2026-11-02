import { useEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  AmbientLight,
  Box3,
  DirectionalLight,
  DoubleSide,
  Group,
  LoadingManager,
  Mesh,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Material,
  type MeshPhongMaterial,
} from "three";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { toVec3, type Avatar3d } from "@/lib/avatar3d";

const SPIN_RAD_PER_SEC = 0.5;
const DRAG_RAD_PER_PX = 0.012;
/** How far the avatar can be tipped towards / away from the viewer. */
const MAX_PITCH = 1.2;

interface Props {
  data: Avatar3d;
  /** Slowly turn the avatar. Dragging always works. */
  spin: boolean;
  onError: () => void;
  className?: string;
}

/** Everything expensive to make: the GL context, the parsed mesh, the uploaded textures. */
interface Stage {
  data: Avatar3d;
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  pivot: Group;
  model: Group;
  /** Which side of the model Roblox put the camera on (-1 or 1). */
  side: number;
}

/**
 * One stage, kept alive while Home is unmounted: coming back to Home re-attaches the canvas instead
 * of rebuilding the context, re-parsing the OBJ and re-uploading the textures (which froze the page).
 */
let stage: Stage | null = null;

function disposeStage(s: Stage) {
  s.model.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    o.geometry.dispose();
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      const mat = m as Material & { map?: { dispose(): void } | null; alphaMap?: { dispose(): void } | null };
      mat.map?.dispose();
      mat.alphaMap?.dispose();
      mat.dispose();
    }
  });
  s.renderer.dispose();
  s.renderer.domElement.remove();
}

function buildStage(data: Avatar3d): Stage {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.domElement.style.cssText = "display:block;width:100%;height:100%;touch-action:none;cursor:grab";

  const scene = new Scene();
  // Three's lights are scaled by pi: ~1.8 + ~1.4 puts a lit white surface just under pure white.
  scene.add(new AmbientLight(0xffffff, 1.8));
  const key = new DirectionalLight(0xffffff, 1.4);
  scene.add(key);

  const pivot = new Group();
  scene.add(pivot);
  const camera = new PerspectiveCamera(40, 1, 0.1, 1000);

  // Textures come as data URLs; the MTL names them by hash, so route those names to the data.
  const files = new Map(data.textures.map((t) => [t.name, t.dataUrl]));
  const manager = new LoadingManager();
  manager.setURLModifier((url) => files.get(url.split(/[\\/]/).pop() ?? "") ?? url);
  const materials = new MTLLoader(manager).parse(data.mtl, "");
  materials.preload();
  const model = new OBJLoader(manager).setMaterials(materials).parse(data.obj);
  model.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      const mat = m as MeshPhongMaterial;
      mat.side = DoubleSide;
      if (mat.map) {
        mat.map.colorSpace = SRGBColorSpace;
        // The texture's transparent parts (the face's surround, bare skin) show the MTL's base colour,
        // which is where Roblox puts the skin tone; opaque parts are just the texture.
        const { r, g, b } = mat.color;
        mat.color.set(0xffffff);
        mat.onBeforeCompile = (shader) => {
          shader.fragmentShader = shader.fragmentShader.replace(
            "#include <map_fragment>",
            `vec4 avatarTex = texture2D( map, vMapUv );
               diffuseColor.rgb *= mix( vec3( ${r.toFixed(4)}, ${g.toFixed(4)}, ${b.toFixed(4)} ), avatarTex.rgb, avatarTex.a );`,
          );
        };
      }
      // The MTL points its opacity map at the albedo, whose alpha isn't coverage; keep everything solid.
      mat.alphaMap = null;
      mat.transparent = false;
      mat.opacity = 1;
      mat.depthWrite = true;
      mat.specular.set(0x000000);
      mat.shininess = 0;
      mat.needsUpdate = true;
    }
  });

  // Centre the model on the pivot, then frame it from Roblox's suggested direction.
  const box = new Box3().setFromObject(model);
  const centre = box.getCenter(new Vector3());
  model.position.sub(centre);
  pivot.add(model);
  const size = box.getSize(new Vector3());
  const aim = toVec3((data.camera as { direction?: unknown } | null)?.direction);
  const dir = aim ? new Vector3(-aim.x, -aim.y, -aim.z).normalize() : new Vector3(0, 0.1, 1).normalize();
  const fitH = size.y / (2 * Math.tan((camera.fov * Math.PI) / 360));
  const distance = fitH * 1.25;
  camera.position.copy(dir.multiplyScalar(distance));
  camera.lookAt(0, 0, 0);
  // Key light from the viewer's side, a little above and to the right, so the front is always lit.
  key.position.copy(camera.position).add(new Vector3(distance * 0.5, distance * 0.7, 0));
  // Yaw about the world's vertical axis whatever the tilt.
  pivot.rotation.order = "YXZ";

  // Roblox may put the camera on either side of the model; a drag should always push the surface
  // under the cursor the way it moved.
  return { data, renderer, scene, camera, pivot, model, side: camera.position.z < 0 ? -1 : 1 };
}

function stageFor(data: Avatar3d): Stage {
  if (stage?.data === data) return stage;
  if (stage) {
    disposeStage(stage);
    stage = null;
  }
  stage = buildStage(data);
  return stage;
}

/** Attaches the stage's canvas to `el` and runs the draw loop; the returned function detaches it. */
function attach(s: Stage, el: HTMLElement, spin: () => boolean): () => void {
  const { renderer, scene, camera, pivot, side } = s;
  const canvas = renderer.domElement;
  el.appendChild(canvas);

  let drag: { x: number; y: number; yaw: number; pitch: number } | null = null;
  let visible = true;
  let last = performance.now();
  let raf = 0;
  let dirty = true;

  const resize = () => {
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    dirty = true;
  };
  const ro = new ResizeObserver(resize);
  ro.observe(el);
  resize();

  const io = new IntersectionObserver(([e]) => {
    visible = !!e?.isIntersecting;
  });
  io.observe(el);

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (!visible || document.visibilityState !== "visible") return;
    if (spin() && !drag) {
      pivot.rotation.y += SPIN_RAD_PER_SEC * dt;
      dirty = true;
    }
    if (dirty) {
      renderer.render(scene, camera);
      dirty = false;
    }
  };
  raf = requestAnimationFrame(frame);

  const down = (e: PointerEvent) => {
    drag = { x: e.clientX, y: e.clientY, yaw: pivot.rotation.y, pitch: pivot.rotation.x };
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = "grabbing";
  };
  const move = (e: PointerEvent) => {
    if (!drag) return;
    pivot.rotation.y = drag.yaw + side * (e.clientX - drag.x) * DRAG_RAD_PER_PX;
    pivot.rotation.x = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, drag.pitch + side * (e.clientY - drag.y) * DRAG_RAD_PER_PX));
    dirty = true;
  };
  const up = (e: PointerEvent) => {
    drag = null;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    canvas.style.cursor = "grab";
  };
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);

  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    io.disconnect();
    canvas.removeEventListener("pointerdown", down);
    canvas.removeEventListener("pointermove", move);
    canvas.removeEventListener("pointerup", up);
    canvas.removeEventListener("pointercancel", up);
    canvas.remove();
  };
}

/** Roblox's 3D avatar (OBJ + MTL + textures) in a WebGL canvas. Drag to turn it. */
export default function AvatarViewer({ data, spin, onError, className }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const spinRef = useRef(spin);
  spinRef.current = spin;
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let detach: (() => void) | undefined;
    const start = () => {
      try {
        detach = attach(stageFor(data), el, () => spinRef.current);
        setReady(true);
      } catch {
        errorRef.current();
      }
    };
    // The first build parses the mesh and uploads textures in one go: wait for the page change to
    // finish painting. A kept stage re-attaches at once.
    const timer = stage?.data === data ? undefined : window.setTimeout(start, 350);
    if (timer === undefined) start();
    return () => {
      window.clearTimeout(timer);
      detach?.();
    };
  }, [data]);

  return (
    <div ref={host} className={className}>
      {!ready && <Skeleton className="absolute inset-3" />}
    </div>
  );
}
