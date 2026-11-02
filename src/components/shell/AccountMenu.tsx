import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, animate, motion, useMotionValue, type AnimationPlaybackControls } from "motion/react";
import {
  ChevronLeft,
  ChevronRight,
  LogIn,
  LogOut,
  Repeat,
  Settings as SettingsIcon,
  TriangleAlert,
  User,
  UserPlus,
  UserRound,
  Users,
} from "lucide-react";
import { SmartImage } from "@/components/ui/SmartImage";
import { cn } from "@/lib/cn";
import { useMotionPrefs } from "@/lib/motion";
import { useHeadshot } from "@/lib/roblox";
import type { AccountSummary } from "@/lib/types";
import { useAccount } from "@/store/account";

const ICON = { size: 16, strokeWidth: 1.75 } as const;
/** How long the sign-out button must be held before it fires. */
const HOLD_MS = 900;

export interface AvatarUser {
  id: string;
  displayName: string;
  username: string;
  avatarUrl?: string | null;
}

/** Account row → the shape `UserAvatar` takes (the row's cached headshot URL is used directly). */
export function toAvatarUser(a: AccountSummary): AvatarUser {
  return { id: String(a.userId), displayName: a.displayName, username: a.username, avatarUrl: a.avatarUrl ?? null };
}

/** Round avatar: the cached headshot URL first, else a fresh Roblox headshot, else an initial. */
export function UserAvatar({ user, size = 32 }: { user: AvatarUser; size?: number }) {
  const headshot = useHeadshot(user.avatarUrl ? null : user.id);
  return (
    <SmartImage
      src={user.avatarUrl ?? headshot.data}
      name={user.displayName}
      className="shrink-0 rounded-full"
      style={{ width: size, height: size }}
    />
  );
}

type PageId = "main" | "accounts";

const ITEM =
  "focus-ring relative flex w-full cursor-pointer items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-left text-sm transition-colors hover:bg-white/8 focus-visible:bg-white/8 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent";
const ITEMS = '[role="menuitem"]:not([disabled])';

const slide = {
  enter: (dir: number) => ({ opacity: 0, x: dir * 28 }),
  center: { opacity: 1, x: 0 },
  exit: (dir: number) => ({ opacity: 0, x: dir * -28 }),
};

/** One slide of the panel: focuses its first item on mount and roves focus with the arrow keys. */
function Page({ dir, children, ref: forwardedRef }: { dir: number; children: ReactNode; ref?: Ref<HTMLDivElement> }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const m = useMotionPrefs();

  // AnimatePresence's popLayout mode measures the exiting child through the ref it injects.
  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      ref.current = el;
      if (typeof forwardedRef === "function") forwardedRef(el);
      else if (forwardedRef) forwardedRef.current = el;
    },
    [forwardedRef],
  );

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(ITEMS)?.focus();
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const items = [...(ref.current?.querySelectorAll<HTMLElement>(ITEMS) ?? [])];
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    let next: number;
    if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    else if (e.key === "ArrowDown") next = (i + 1) % items.length;
    else next = (i - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <motion.div
      ref={setRef}
      role="menu"
      custom={dir}
      variants={slide}
      initial="enter"
      animate="center"
      exit="exit"
      transition={m.fast}
      onKeyDown={onKeyDown}
    >
      {children}
    </motion.div>
  );
}

function Row({
  icon,
  label,
  trailing,
  danger,
  disabled,
  title,
  onClick,
}: {
  icon?: ReactNode;
  label: ReactNode;
  trailing?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button type="button" role="menuitem" disabled={disabled} title={title} onClick={onClick} className={cn(ITEM, danger && "text-danger")}>
      {icon && <span className="flex size-5 shrink-0 items-center justify-center">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
    </button>
  );
}

/** Press and hold (pointer, or Enter/Space) to confirm; releasing early cancels and drains the fill. */
function HoldToRemove({ name, onComplete }: { name: string; onComplete: () => void }) {
  const progress = useMotionValue(0);
  const run = useRef<AnimationPlaybackControls | null>(null);
  const done = useRef(false);
  const [holding, setHolding] = useState(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const start = () => {
    if (run.current || done.current) return;
    setHolding(true);
    run.current = animate(progress, 1, {
      duration: HOLD_MS / 1000,
      ease: "linear",
      onComplete: () => {
        run.current = null;
        done.current = true;
        setHolding(false);
        onCompleteRef.current();
      },
    });
  };

  const cancel = () => {
    if (!run.current) return;
    run.current.stop();
    run.current = null;
    setHolding(false);
    animate(progress, 0, { duration: 0.2 });
  };

  useEffect(
    () => () => {
      run.current?.stop();
    },
    [],
  );

  const isHoldKey = (e: KeyboardEvent) => e.key === "Enter" || e.key === " ";

  return (
    <button
      type="button"
      role="menuitem"
      aria-label={`Hold to remove ${name}`}
      title="Press and hold to remove this account from Muffin"
      onClick={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        if (e.button === 0) start();
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onKeyDown={(e) => {
        if (!isHoldKey(e)) return;
        e.preventDefault();
        if (!e.repeat) start();
      }}
      onKeyUp={(e) => {
        if (!isHoldKey(e)) return;
        e.preventDefault();
        cancel();
      }}
      onBlur={cancel}
      className={cn(ITEM, "select-none text-danger")}
    >
      <motion.span aria-hidden style={{ scaleX: progress }} className="pointer-events-none absolute inset-0 origin-left rounded-[9px] bg-danger/20" />
      <span className="relative flex size-5 shrink-0 items-center justify-center">
        <LogOut {...ICON} />
      </span>
      <span className="relative min-w-0 flex-1 truncate">{holding ? "Keep holding…" : `Hold to remove ${name}`}</span>
    </button>
  );
}

/** Top-right account dropdown: signed-in identity or guest sign-in options. */
export function AccountMenu() {
  const navigate = useNavigate();
  const m = useMotionPrefs();
  const accounts = useAccount((s) => s.accounts);
  const activeUserId = useAccount((s) => s.activeUserId);
  const busyUserId = useAccount((s) => s.busyUserId);
  const accountSigningIn = useAccount((s) => s.signingIn);
  const accountSignIn = useAccount((s) => s.signIn);
  const accountSignOut = useAccount((s) => s.signOut);
  const switchTo = useAccount((s) => s.switchTo);
  const active = accounts.find((a) => a.userId === activeUserId) ?? null;
  const user = active ? toAvatarUser(active) : null;
  const others = accounts.filter((a) => a.userId !== activeUserId);

  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<PageId>("main");
  const [dir, setDir] = useState(1);
  const [height, setHeight] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    setPage("main");
    setDir(1);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  const go = (next: PageId) => {
    setDir(next === "accounts" ? 1 : -1);
    setPage(next);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) close(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, close]);

  // Track the content height so the panel resizes smoothly between pages.
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!open || !el) return;
    setHeight(el.offsetHeight);
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);

  const pick = (fn: () => void) => () => {
    close();
    fn();
  };

  const hidden = m.full ? { opacity: 0, scale: 0.86, filter: "blur(8px)" } : { opacity: 0, scale: 0.97, filter: "blur(0px)" };
  const shown = { opacity: 1, scale: 1, filter: "blur(0px)" };

  const signInLabel = accountSigningIn ? "Roblox sign-in open…" : "Sign in to Roblox";

  const mainPage = user && active && (
    <Page key="main" dir={dir}>
      <div className="flex items-center gap-3 rounded-[11px] bg-white/6 px-3 py-3">
        <UserAvatar user={user} size={44} />
        <div className="min-w-0">
          <div className="truncate font-medium">{user.displayName}</div>
          <div className="truncate text-xs text-muted">@{user.username}</div>
          {active.expired && (
            <div role="status" className="mt-1 flex items-center gap-1 text-xs text-danger">
              <TriangleAlert size={12} strokeWidth={1.75} className="shrink-0" />
              Session expired
            </div>
          )}
        </div>
      </div>
      <div className="mt-1.5 space-y-0.5">
        <Row icon={<User {...ICON} />} label="Profile" onClick={pick(() => navigate("/profile"))} />
        <Row icon={<Users {...ICON} />} label="Friends" onClick={pick(() => navigate("/friends"))} />
        <Row icon={<SettingsIcon {...ICON} />} label="Settings" onClick={pick(() => navigate("/settings"))} />
      </div>
      <div className="my-1.5 h-px bg-white/8" />
      <div className="space-y-0.5">
        {active.expired && (
          <Row
            icon={<LogIn {...ICON} />}
            label={signInLabel === "Sign in to Roblox" ? "Sign in again" : signInLabel}
            disabled={accountSigningIn}
            onClick={pick(() => void accountSignIn())}
          />
        )}
        <Row
          icon={<Repeat {...ICON} />}
          label="Switch account"
          trailing={
            <span className="flex items-center gap-1 text-xs text-muted">
              {others.length > 0 && <span>{others.length}</span>}
              <ChevronRight size={14} strokeWidth={1.75} />
            </span>
          }
          onClick={() => go("accounts")}
        />
        <HoldToRemove name={active.displayName} onComplete={pick(() => void accountSignOut())} />
      </div>
    </Page>
  );

  const accountsPage = (
    <Page key="accounts" dir={dir}>
      <Row icon={<ChevronLeft {...ICON} />} label={<span className="font-medium">Switch account</span>} onClick={() => go("main")} />
      <div className="my-1.5 h-px bg-white/8" />
      <div className="max-h-[260px] space-y-0.5 overflow-y-auto">
        {others.length === 0 && <p className="px-2.5 py-2 text-xs text-muted">No other accounts yet.</p>}
        {others.map((a) => (
          <Row
            key={a.userId}
            icon={<UserAvatar user={toAvatarUser(a)} size={28} />}
            label={
              <span className="block">
                <span className="block truncate">{a.displayName}</span>
                <span className={cn("block truncate text-xs", a.expired ? "text-danger" : "text-muted")}>
                  {a.expired ? "Session expired · sign in again" : `@${a.username}`}
                </span>
              </span>
            }
            title={`@${a.username}`}
            disabled={busyUserId != null || (a.expired && accountSigningIn)}
            onClick={pick(() => void (a.expired ? accountSignIn() : switchTo(a.userId)))}
          />
        ))}
      </div>
      <div className="my-1.5 h-px bg-white/8" />
      <Row
        icon={<UserPlus {...ICON} />}
        label={accountSigningIn ? "Roblox sign-in open…" : "Add account"}
        disabled={accountSigningIn}
        onClick={pick(() => void accountSignIn())}
      />
    </Page>
  );

  const guestPage = (
    <Page key="guest" dir={dir}>
      <div className="flex items-center gap-3 rounded-[11px] bg-white/6 px-3 py-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white/8">
          <UserRound size={20} strokeWidth={1.75} className="text-muted" />
        </span>
        <div className="min-w-0">
          <div className="truncate font-medium">Guest</div>
          <div className="truncate text-xs text-muted">Not signed in</div>
        </div>
      </div>
      <div className="mt-1.5 space-y-0.5">
        <Row icon={<LogIn {...ICON} />} label={signInLabel} disabled={accountSigningIn} onClick={pick(() => void accountSignIn())} />
        <Row icon={<UserRound {...ICON} />} label="Continue as guest" onClick={pick(() => {})} />
      </div>
    </Page>
  );

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        aria-label="Account"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        className="focus-ring flex size-9 cursor-pointer items-center justify-center overflow-hidden rounded-full bg-white/6 transition-colors hover:bg-white/12"
        data-open={open}
      >
        {user ? <UserAvatar user={user} size={36} /> : <UserRound size={18} strokeWidth={1.75} className="text-muted" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={hidden}
            animate={shown}
            exit={{ ...hidden, transition: m.fast }}
            transition={m.spring}
            style={{ transformOrigin: "top right" }}
            className="absolute right-0 top-full z-50 mt-2 w-[288px]"
          >
            <motion.div
              initial={false}
              animate={{ height: height ?? "auto" }}
              transition={m.springSoft}
              className="glass overflow-hidden rounded-[14px] text-sm"
            >
              <div ref={contentRef} className="relative p-1.5">
                <AnimatePresence mode="popLayout" initial={false} custom={dir}>
                  {user ? (page === "main" ? mainPage : accountsPage) : guestPage}
                </AnimatePresence>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
