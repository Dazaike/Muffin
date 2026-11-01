import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ipc } from "@/lib/ipc";
import { useBackground } from "./background";
import { DEFAULT_SETTINGS, mergeSettings, useSettings } from "./settings";
import { useUi } from "./ui";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    backgroundPick: vi.fn(),
    backgroundInfo: vi.fn(),
    backgroundRead: vi.fn(),
    backgroundClear: vi.fn(),
    settingsSet: vi.fn(),
  },
  autostart: { set: vi.fn(), isEnabled: vi.fn() },
  toAppError: (e: unknown) => ({ code: "storage", message: e instanceof Error ? e.message : String(e) }),
}));

const api = vi.mocked(ipc);

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

let created: string[];
let revoked: string[];

beforeEach(() => {
  vi.resetAllMocks();
  created = [];
  revoked = [];
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
    const u = `blob:test/${created.length}`;
    created.push(u);
    return u;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((u) => {
    revoked.push(u);
  });
  useBackground.setState({ url: null, revision: 0, busy: false });
  useSettings.setState({ values: { ...DEFAULT_SETTINGS, backgroundImage: true }, hydrated: true });
  useUi.setState({ toasts: [] });
  api.settingsSet.mockResolvedValue(null as never);
});

afterEach(() => {
  useBackground.getState().release();
  vi.restoreAllMocks();
});

describe("load", () => {
  it("builds a blob URL from the stored bytes and revokes the previous one", async () => {
    api.backgroundInfo.mockResolvedValue({ present: true, mime: "image/png" });
    api.backgroundRead.mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);

    await useBackground.getState().load();
    expect(useBackground.getState().url).toBe("blob:test/0");

    await useBackground.getState().load();
    expect(useBackground.getState().url).toBe("blob:test/1");
    expect(revoked).toEqual(["blob:test/0"]);
  });

  it("leaves no URL when nothing is stored", async () => {
    api.backgroundInfo.mockResolvedValue({ present: false, mime: null });
    await useBackground.getState().load();
    expect(useBackground.getState().url).toBeNull();
    expect(api.backgroundRead).not.toHaveBeenCalled();
  });

  it("a slow older load never replaces a newer one", async () => {
    const slow = deferred<ArrayBuffer>();
    api.backgroundInfo.mockResolvedValue({ present: true, mime: "image/png" });
    api.backgroundRead.mockReturnValueOnce(slow.promise).mockResolvedValueOnce(new Uint8Array([9]).buffer);

    const first = useBackground.getState().load();
    await vi.waitFor(() => expect(api.backgroundRead).toHaveBeenCalledTimes(1));
    await useBackground.getState().load();
    expect(useBackground.getState().url).toBe("blob:test/0");

    slow.resolve(new Uint8Array([1]).buffer);
    await first;
    expect(useBackground.getState().url).toBe("blob:test/0");
    expect(created).toHaveLength(1);
  });

  it("toasts and clears the URL when reading fails", async () => {
    api.backgroundInfo.mockResolvedValue({ present: true, mime: "image/png" });
    api.backgroundRead.mockRejectedValue(new Error("disk gone"));
    await useBackground.getState().load();
    expect(useBackground.getState().url).toBeNull();
    expect(useUi.getState().toasts[0]?.message).toContain("disk gone");
  });
});

describe("pick / remove", () => {
  it("does nothing when the dialog is cancelled", async () => {
    api.backgroundPick.mockResolvedValue(null);
    useSettings.setState({ values: { ...DEFAULT_SETTINGS, backgroundImage: false } });
    await useBackground.getState().pick();
    expect(api.settingsSet).not.toHaveBeenCalled();
    expect(useBackground.getState().revision).toBe(0);
    expect(useBackground.getState().busy).toBe(false);
  });

  it("activates the image and bumps the revision after a successful pick", async () => {
    api.backgroundPick.mockResolvedValue({ ext: "png", bytes: 10 });
    useSettings.setState({ values: { ...DEFAULT_SETTINGS, backgroundImage: false } });
    await useBackground.getState().pick();
    expect(api.settingsSet).toHaveBeenCalledWith("backgroundImage", true);
    expect(useSettings.getState().values.backgroundImage).toBe(true);
    expect(useBackground.getState().revision).toBe(1);
  });

  it("surfaces validation errors from Rust as a toast and leaves the setting alone", async () => {
    api.backgroundPick.mockRejectedValue(new Error("That image is larger than 12 MB."));
    useSettings.setState({ values: { ...DEFAULT_SETTINGS, backgroundImage: false } });
    await useBackground.getState().pick();
    expect(useUi.getState().toasts[0]?.message).toContain("12 MB");
    expect(useSettings.getState().values.backgroundImage).toBe(false);
    expect(useBackground.getState().busy).toBe(false);
  });

  it("remove clears the file, deactivates the setting and revokes the URL", async () => {
    api.backgroundInfo.mockResolvedValue({ present: true, mime: "image/png" });
    api.backgroundRead.mockResolvedValue(new Uint8Array([1]).buffer);
    api.backgroundClear.mockResolvedValue(null);
    await useBackground.getState().load();

    await useBackground.getState().remove();
    expect(api.backgroundClear).toHaveBeenCalledTimes(1);
    expect(api.settingsSet).toHaveBeenCalledWith("backgroundImage", false);
    expect(useBackground.getState().url).toBeNull();
    expect(revoked).toEqual(["blob:test/0"]);
  });
});

describe("mergeSettings background values", () => {
  it("accepts in-range integers", () => {
    const s = mergeSettings({ backgroundImage: true, backgroundDim: 90, backgroundBlur: 0 });
    expect(s).toMatchObject({ backgroundImage: true, backgroundDim: 90, backgroundBlur: 0 });
  });

  it("falls back to defaults for out-of-range, fractional or mistyped values", () => {
    const s = mergeSettings({ backgroundDim: 91, backgroundBlur: 3.5, backgroundImage: "yes" });
    expect(s.backgroundDim).toBe(DEFAULT_SETTINGS.backgroundDim);
    expect(s.backgroundBlur).toBe(DEFAULT_SETTINGS.backgroundBlur);
    expect(s.backgroundImage).toBe(false);
    expect(mergeSettings({ backgroundBlur: 25 }).backgroundBlur).toBe(0);
    expect(mergeSettings({ backgroundDim: -1 }).backgroundDim).toBe(55);
  });
});
