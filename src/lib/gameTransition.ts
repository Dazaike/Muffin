/**
 * Shared-element transition from a game card's picture to the details page hero, using the browser's
 * View Transitions API. The clicked card's image and the details hero share one `view-transition-name`
 * only while the transition runs; styling for it lives in index.css.
 */
export const HERO_VT_NAME = "game-hero";
/** Marks the details hero so navigation knows when the new page is ready to be captured. */
export const HERO_VT_ATTR = "data-vt-target";

/** The same morph for a person: their avatar in a list becomes the avatar on their profile. */
export const USER_VT_NAME = "user-avatar";
export const USER_VT_ATTR = "data-vt-user";

let morphNavs = 0;
/**
 * Counts navigations done as a shared-element morph. The shell remounts its page container on each, so the
 * old page is gone the moment the new one renders (two pages carrying the same view-transition-name would cancel the morph).
 */
export const morphNavCount = () => morphNavs;
const noteMorphNav = () => void morphNavs++;

const READY_TIMEOUT_MS = 800;
const POLL_MS = 16;

type ViewTransitionDoc = Document & {
  startViewTransition?: (update: () => Promise<void>) => { finished: Promise<unknown> };
};

/** Resolves once the details hero is in the DOM (or after a timeout, so a slow page still opens). */
function heroReady(attr: string): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now();
    // setTimeout, not rAF: rendering is paused while a view transition waits for its update.
    const tick = () => {
      if (document.querySelector(`[${attr}]`) || performance.now() - start > READY_TIMEOUT_MS) resolve();
      else setTimeout(tick, POLL_MS);
    };
    tick();
  });
}

/** Runs `go` (the navigation), morphing `source` into the details hero (or, for `user`, the profile avatar) when the browser supports it. */
export function navigateWithMorph(source: HTMLElement | null | undefined, go: () => void, enabled: boolean, kind: "game" | "user" = "game"): void {
  const doc = document as ViewTransitionDoc;
  if (!enabled || !source || !doc.startViewTransition) {
    go();
    return;
  }
  const name = kind === "user" ? USER_VT_NAME : HERO_VT_NAME;
  source.style.setProperty("view-transition-name", name);
  const transition = doc.startViewTransition(() => {
    noteMorphNav();
    go();
    return heroReady(kind === "user" ? USER_VT_ATTR : HERO_VT_ATTR);
  });
  void transition.finished.finally(() => source.style.removeProperty("view-transition-name"));
}

export const CARD_ATTR = "data-game-card";

/** The picture of the on-screen card for `placeId` (the first visible one when a game appears twice). */
function visibleCardImage(placeId: number): HTMLElement | null {
  for (const card of document.querySelectorAll(`[${CARD_ATTR}="${placeId}"]`)) {
    const image = card.querySelector("img")?.parentElement;
    const r = image?.getBoundingClientRect();
    if (image && r && r.bottom > 0 && r.top < window.innerHeight) return image;
  }
  return null;
}

/** Resolves with whatever `find` returns once it's non-null, or null after the timeout. */
function ready(find: () => HTMLElement | null, timeout = READY_TIMEOUT_MS): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const start = performance.now();
    const tick = () => {
      const found = find();
      if (found || performance.now() - start > timeout) resolve(found);
      else setTimeout(tick, POLL_MS);
    };
    tick();
  });
}

const cardReady = (placeId: number) => ready(() => visibleCardImage(placeId));

/** The reverse of `navigateWithMorph`: the details hero shrinks back into the card for `placeId` on the page `goBack` returns to. */
export function navigateBackWithMorph(placeId: number, goBack: () => void, enabled: boolean): void {
  const doc = document as ViewTransitionDoc;
  if (!enabled || !doc.startViewTransition) {
    goBack();
    return;
  }
  let target: HTMLElement | null = null;
  const transition = doc.startViewTransition(async () => {
    noteMorphNav();
    goBack();
    // The hero already carries the shared name; give it to the card it came from in the new page.
    target = await cardReady(placeId);
    target?.style.setProperty("view-transition-name", HERO_VT_NAME);
  });
  void transition.finished.finally(() => (target as HTMLElement | null)?.style.removeProperty("view-transition-name"));
}

export const USER_AVATAR_ATTR = "data-user-avatar";

/** The picture of the on-screen avatar for `userId` (the first visible one when a person appears twice). */
function visibleAvatar(userId: number): HTMLElement | null {
  for (const holder of document.querySelectorAll(`[${USER_AVATAR_ATTR}="${userId}"]`)) {
    const image = holder.querySelector("img")?.parentElement ?? (holder as HTMLElement);
    const r = image.getBoundingClientRect();
    if (r.bottom > 0 && r.top < window.innerHeight) return image;
  }
  return null;
}

/** The reverse of the profile morph: the profile's avatar shrinks back into `userId`'s avatar on the page `goBack` returns to. */
export function navigateBackToUserWithMorph(userId: number, goBack: () => void, enabled: boolean): void {
  const doc = document as ViewTransitionDoc;
  if (!enabled || !doc.startViewTransition) {
    goBack();
    return;
  }
  let target: HTMLElement | null = null;
  const transition = doc.startViewTransition(async () => {
    noteMorphNav();
    goBack();
    // Short wait: if the avatar isn't on that page any more, going back should still feel instant.
    target = await ready(() => visibleAvatar(userId), 250);
    target?.style.setProperty("view-transition-name", USER_VT_NAME);
  });
  void transition.finished.finally(() => (target as HTMLElement | null)?.style.removeProperty("view-transition-name"));
}
