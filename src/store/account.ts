import { create } from "zustand";
import { ipc, toAppError } from "@/lib/ipc";
import { queryClient } from "@/lib/queryClient";
import type { AccountStatus, AccountsList, AccountSummary } from "@/lib/types";
import { toast } from "./ui";

/**
 * Multiple saved Roblox accounts; exactly one is ACTIVE and every account-scoped Rust command acts
 * as it. Cookies never reach the frontend.
 *
 * Making something account-scoped: either put `useActiveAccountId()` in its TanStack query key, or
 * use a key starting with `"roblox-account"` (these are dropped on every account change). Zustand
 * stores can `useAccount.subscribe((s, prev) => s.activeUserId !== prev.activeUserId && …)`.
 */
interface AccountState {
  /** Active account's identity, validated against Roblox; `null` while (re)checking. */
  status: AccountStatus | null;
  statusError: string | null;
  /** True while the Roblox login window is open. */
  signingIn: boolean;
  accounts: AccountSummary[];
  /** `null` = nobody signed in (guest). Meaningful only once `listReady`. */
  activeUserId: number | null;
  listReady: boolean;
  /** Account currently being switched to / removed. */
  busyUserId: number | null;
  /** Reloads the account list and re-validates the active session. */
  reload: () => Promise<void>;
  /** Subscribes to backend account events; call once at boot. */
  init: () => Promise<void>;
  /** Opens the Roblox login and ADDS the account (also re-logs an expired one). */
  signIn: () => Promise<boolean>;
  switchTo: (userId: number) => Promise<boolean>;
  remove: (userId: number) => Promise<void>;
  /** Signs out the active account only. */
  signOut: () => Promise<void>;
}

/** Id of the active account, or `null` for guest. */
export const useActiveAccountId = (): number | null => useAccount((s) => s.activeUserId);

let statusSeq = 0;
let initialised = false;

export const useAccount = create<AccountState>((set, get) => {
  const refreshStatus = async () => {
    const seq = ++statusSeq;
    try {
      const status = await ipc.accountStatus();
      if (seq === statusSeq) set({ status, statusError: null });
    } catch (e) {
      if (seq === statusSeq) set({ statusError: toAppError(e).message });
    }
  };

  /** Apply a list from the backend; refresh the identity when the active account changed. */
  const applyList = (list: AccountsList, force = false) => {
    const prev = get();
    const changed = !prev.listReady || prev.activeUserId !== list.activeUserId;
    set({ accounts: list.accounts, activeUserId: list.activeUserId, listReady: true });
    if (changed) {
      statusSeq++;
      set({ status: null, statusError: null });
      queryClient.removeQueries({ queryKey: ["roblox-account"] });
    }
    if (changed || force) void refreshStatus();
  };

  const syncList = async () => {
    try {
      applyList(await ipc.accountsList());
    } catch (e) {
      set({ statusError: toAppError(e).message, listReady: true });
    }
  };

  const nameOf = (id: number) => get().accounts.find((a) => a.userId === id)?.displayName ?? "Account";

  return {
    status: null,
    statusError: null,
    signingIn: false,
    accounts: [],
    activeUserId: null,
    listReady: false,
    busyUserId: null,
    reload: async () => {
      try {
        applyList(await ipc.accountsList(), get().listReady);
      } catch (e) {
        set({ statusError: toAppError(e).message, listReady: true });
      }
    },
    init: async () => {
      if (initialised) return;
      initialised = true;
      try {
        await Promise.all([
          ipc.onAccountChanged(() => void syncList()),
          ipc.onAccountExpired((id) => {
            const name = nameOf(id);
            void syncList();
            toast.withAction(`${name}'s Roblox session expired`, { label: "Sign in again", onClick: () => void get().signIn() }, 8000);
          }),
        ]);
      } catch {
        initialised = false;
      }
    },
    signIn: async () => {
      if (get().signingIn) return false;
      set({ signingIn: true });
      try {
        const list = await ipc.accountAdd();
        applyList(list, true);
        const user = list.accounts.find((a) => a.userId === list.activeUserId);
        toast.success(`Signed in as ${user?.displayName ?? "Roblox user"}`);
        return true;
      } catch (e) {
        toast.error(toAppError(e).message);
        return false;
      } finally {
        set({ signingIn: false });
      }
    },
    switchTo: async (userId) => {
      if (get().busyUserId != null || userId === get().activeUserId) return false;
      set({ busyUserId: userId });
      try {
        applyList(await ipc.accountSwitch(userId));
        toast.success(`Switched to ${nameOf(userId)}`);
        return true;
      } catch (e) {
        const err = toAppError(e);
        if (err.code === "auth_expired") {
          toast.withAction(err.message, { label: "Sign in again", onClick: () => void get().signIn() }, 8000);
        } else {
          toast.error(err.message);
        }
        await syncList(); // surfaces the expired flag in the list
        return false;
      } finally {
        set({ busyUserId: null });
      }
    },
    remove: async (userId) => {
      if (get().busyUserId != null) return;
      const name = nameOf(userId);
      set({ busyUserId: userId });
      try {
        applyList(await ipc.accountRemove(userId));
        toast.info(`Removed ${name}`);
      } catch (e) {
        toast.error(toAppError(e).message);
      } finally {
        set({ busyUserId: null });
      }
    },
    signOut: async () => {
      const id = get().activeUserId;
      if (id == null) return;
      try {
        applyList(await ipc.accountSignOut());
      } catch (e) {
        toast.error(toAppError(e).message);
      }
    },
  };
});
