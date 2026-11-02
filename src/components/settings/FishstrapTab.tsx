import { useEffect, useId, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useMotionPrefs } from "@/lib/motion";
import { useQueryClient } from "@tanstack/react-query";
import { CloudDownload, EyeOff, Flag, Paintbrush, Plug, Plus, RefreshCw, Rocket, Search, SlidersHorizontal, Trash2, Wrench } from "lucide-react";
import { HidePage } from "@/components/fishstrap/HidePage";
import { Button } from "@/components/ui/Button";
import { inputClass } from "@/components/details/serverUi";
import { cn } from "@/lib/cn";
import { FISHSTRAP_KEYS, useFastFlags, useFishstrapMods, useFishstrapStatus, useLatestRobloxVersion } from "@/lib/fishstrap";
import { mergeFlags, parseFlagJson } from "@/lib/fastflags";
import { SCHEMA_PAGES, searchItems, type Item } from "@/lib/fishstrapSchema";
import { formatBytes } from "@/lib/format";
import { ipc, toAppError } from "@/lib/ipc";
import { installFishstrap } from "@/lib/ensureLauncher";
import type { FastFlag } from "@/lib/types";
import { SettingRow, SettingsSection } from "./SettingRow";
import { AdvancedView, ItemRow, SchemaPageView, useSettingsEditor } from "./FishstrapSettings";

function Value({ children }: { children: ReactNode }) {
  return <span className="block max-w-[420px] truncate text-sm select-text">{children}</span>;
}

const yesNo = (b: boolean) => (b ? "Yes" : "No");

function Err({ message }: { message: string | null }) {
  return message ? <div className="px-5 py-3 text-sm text-danger">{message}</div> : null;
}

interface NavPage {
  id: string;
  label: string;
  description: string;
  icon: ReactNode;
}

const ICON = { size: 16, strokeWidth: 1.75 } as const;
const FASTFLAG_MANAGER: Item = {
  kind: "switch",
  key: "UseFastFlagManager",
  title: "Allow Fishstrap to manage Fast Flags",
  description: "Disabling this will prevent anything configured here from being applied to Roblox.",
};

const pageDescription = (id: string) => SCHEMA_PAGES.find((p) => p.id === id)?.description ?? "";

const FIRST_NAV: NavPage = {
  id: "hide",
  label: "Hide Fishstrap",
  icon: <EyeOff {...ICON} />,
  description: "Run Fishstrap in the background and see its launch progress in Muffin.",
};

const NAV: NavPage[] = [
  FIRST_NAV,
  { id: "integrations", label: "Integrations", icon: <Plug {...ICON} />, description: pageDescription("integrations") },
  { id: "bootstrapper", label: "Bootstrapper", icon: <Rocket {...ICON} />, description: pageDescription("bootstrapper") },
  { id: "deployment", label: "Deployment", icon: <CloudDownload {...ICON} />, description: pageDescription("deployment") },
  { id: "mods", label: "Mods", icon: <Wrench {...ICON} />, description: "Manage and apply file mods to the Roblox game client." },
  { id: "fastflags", label: "FastFlags", icon: <Flag {...ICON} />, description: "Roblox only applies whitelisted FFlags." },
  { id: "appearance", label: "Appearance", icon: <Paintbrush {...ICON} />, description: pageDescription("appearance") },
  { id: "advanced", label: "Advanced", icon: <SlidersHorizontal {...ICON} />, description: "Every other value in Fishstrap's Settings.json." },
];

export function FishstrapTab() {
  const status = useFishstrapStatus();
  const s = status.data;
  const installed = !!s?.installed;
  const latest = useLatestRobloxVersion(s?.channel, installed);
  const ed = useSettingsEditor();
  const group = useId();
  const m = useMotionPrefs();
  const [page, setPage] = useState("hide");
  const [query, setQuery] = useState("");

  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(toAppError(e).message);
    }
  };

  if (status.isError) {
    return <div className="px-1 text-sm text-danger">Couldn't check Fishstrap: {status.error.message}</div>;
  }
  if (!s) return <div className="px-1 text-sm text-muted">Checking…</div>;

  if (!installed) {
    return (
      <SettingsSection title="Status">
        <SettingRow title="Fishstrap isn't installed" description="Install it to manage its settings here and see launch progress in Muffin.">
          <div className="flex items-center gap-2">
            <Button variant="glass" size="sm" onClick={() => void installFishstrap()}>
              Install Fishstrap
            </Button>
            <Button variant="glass" size="sm" onClick={() => void run(() => ipc.fishstrapOpenDownload())}>
              Download page
            </Button>
          </div>
        </SettingRow>
        <Err message={error} />
      </SettingsSection>
    );
  }

  const refetchAll = () => {
    void status.refetch();
    void latest.refetch();
  };

  let versionText: string;
  if (latest.isPending && latest.fetchStatus !== "idle") {
    versionText = "Checking…";
  } else if (!latest.data) {
    versionText = "Latest version unavailable";
  } else if (latest.data === s.installedVersion) {
    versionText = "Up to date";
  } else {
    versionText = "Update available; Fishstrap installs it on your next launch";
  }

  const searching = query.trim() !== "";
  const hits = searchItems(query);
  const current = NAV.find((n) => n.id === page) ?? FIRST_NAV;
  const schema = SCHEMA_PAGES.find((p) => p.id === current.id);

  const statusSection = (
    <SettingsSection title="Status">
      <SettingRow title="Installed" description={s.dir ?? undefined}>
        <Value>Yes</Value>
      </SettingRow>
      <SettingRow title="Roblox version" description={versionText}>
        <Value>{s.installedVersion ?? "Not downloaded yet"}</Value>
      </SettingRow>
      <SettingRow title="Fishstrap running" description="Close Fishstrap before changing its settings.">
        <Value>{yesNo(s.fishstrapRunning)}</Value>
      </SettingRow>
      <div className="flex justify-end px-5 py-4">
        <Button
          variant="glass"
          size="sm"
          disabled={status.isFetching}
          icon={<RefreshCw size={14} strokeWidth={1.75} className={status.isFetching ? "spin" : undefined} />}
          onClick={refetchAll}
        >
          Re-check
        </Button>
      </div>
    </SettingsSection>
  );

  let body: ReactNode;
  if (searching) {
    body = (
      <SettingsSection title={`Results for "${query.trim()}"`}>
        {hits.length === 0 && <div className="px-5 py-4 text-sm text-muted">No matching settings.</div>}
        {hits.map(({ page: p, item }, i) => (
          <ItemRow key={`${item.key}:${i}`} item={item} ed={ed} hint={p.label} />
        ))}
      </SettingsSection>
    );
  } else if (current.id === "deployment") {
    body = (
      <>
        {statusSection}
        {schema && <SchemaPageView page={schema} ed={ed} />}
        <MaintenanceSection />
      </>
    );
  } else if (current.id === "mods") {
    body = <ModsSection />;
  } else if (current.id === "fastflags") {
    body = (
      <>
        <SettingsSection>
          <ItemRow item={FASTFLAG_MANAGER} ed={ed} />
        </SettingsSection>
        <FlagsSection />
      </>
    );
  } else if (current.id === "hide") {
    body = <HidePage />;
  } else if (current.id === "advanced") {
    body = <AdvancedView ed={ed} />;
  } else {
    body = schema ? <SchemaPageView page={schema} ed={ed} /> : null;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
      <div className="flex flex-col gap-3 lg:sticky lg:top-4 lg:self-start">
        <label className="relative block">
          <Search size={14} strokeWidth={1.75} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            aria-label="Search Fishstrap settings"
            className={cn(inputClass, "w-full pl-9")}
          />
        </label>
        <div className="no-scrollbar flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
          {NAV.map((n) => {
            const isActive = !searching && n.id === current.id;
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => {
                  setPage(n.id);
                  setQuery("");
                }}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "focus-ring relative flex shrink-0 cursor-pointer items-center gap-2.5 rounded-[12px] px-3 py-2 text-left text-sm font-medium transition-colors",
                  isActive ? "text-fg" : "text-muted hover:bg-white/5 hover:text-fg",
                )}
              >
                {isActive && (
                  <motion.span
                    layoutId={`fishstrap-tab-${group}`}
                    transition={m.spring}
                    className="absolute inset-0 rounded-[12px] bg-white/8"
                  >
                    <span className="accent-gradient absolute top-2.5 bottom-2.5 left-0 w-[3px] rounded-full max-lg:hidden" />
                  </motion.span>
                )}
                <span className="relative flex items-center gap-2.5">
                  {n.icon}
                  {n.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={searching ? "search" : current.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={m.fast}
          className="flex min-w-0 flex-col gap-6"
        >
          <header>
            <h2 className="text-xl font-semibold">{searching ? "Search" : current.label}</h2>
            {!searching && <p className="mt-1 text-sm text-muted">{current.description}</p>}
          </header>
          {ed.loadError && <div className="text-sm text-danger">{ed.loadError}</div>}
          {body}
          {ed.error && <div className="text-sm text-danger">{ed.error}</div>}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function FlagsSection() {
  const qc = useQueryClient();
  const query = useFastFlags(true);
  const [flags, setFlags] = useState<FastFlag[]>([]);
  const [dirty, setDirty] = useState(false);
  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("");
  const [importText, setImportText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<number | null>(null);

  useEffect(() => {
    if (query.data && !dirty) setFlags(query.data);
  }, [query.data, dirty]);

  const edit = (next: FastFlag[]) => {
    setFlags(next);
    setDirty(true);
    setSaved(null);
  };

  const add = () => {
    const name = newName.trim();
    if (!name || !newValue.trim()) {
      setError("Enter a flag name and value.");
      return;
    }
    setError(null);
    edit(mergeFlags(flags, [{ name, value: newValue.trim() }]));
    setNewName("");
    setNewValue("");
  };

  const importJson = () => {
    const r = parseFlagJson(importText);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    setError(null);
    edit(mergeFlags(flags, r.flags));
    setImportText("");
  };

  const save = async () => {
    setError(null);
    try {
      const n = await ipc.fastflagsSet(flags);
      setDirty(false);
      setSaved(n);
      await qc.invalidateQueries({ queryKey: FISHSTRAP_KEYS.flags });
    } catch (e) {
      setError(toAppError(e).message);
    }
  };

  return (
    <SettingsSection title="FastFlags">
      {query.isError && <Err message={query.error.message} />}
      <div className="flex flex-col gap-2 px-5 py-4">
        {flags.length === 0 && <div className="text-sm text-muted">No FastFlags set.</div>}
        {flags.map((f) => (
          <div key={f.name} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm select-text" title={f.name}>
              {f.name}
            </span>
            <input
              value={f.value}
              maxLength={256}
              onChange={(e) => edit(flags.map((x) => (x.name === f.name ? { ...x, value: e.target.value } : x)))}
              className={inputClass}
              aria-label={`${f.name} value`}
            />
            <Button
              variant="glass"
              size="sm"
              aria-label={`Delete ${f.name}`}
              icon={<Trash2 size={14} strokeWidth={1.75} />}
              onClick={() => edit(flags.filter((x) => x.name !== f.name))}
            />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 px-5 py-4">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="FFlagName"
          spellCheck={false}
          maxLength={128}
          className={inputClass}
        />
        <input
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          placeholder="Value"
          spellCheck={false}
          maxLength={256}
          className={inputClass}
        />
        <Button variant="glass" size="sm" icon={<Plus size={14} strokeWidth={1.75} />} onClick={add}>
          Add flag
        </Button>
      </div>
      <div className="flex flex-col gap-2 px-5 py-4">
        <textarea
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder={'Paste JSON, e.g. { "FFlagExample": true, "DFIntExample": 5 }'}
          rows={3}
          spellCheck={false}
          className={inputClass}
        />
        <div>
          <Button variant="glass" size="sm" disabled={!importText.trim()} onClick={importJson}>
            Import JSON
          </Button>
        </div>
      </div>
      <Err message={error} />
      <div className="flex items-center justify-between gap-4 px-5 py-4">
        <span className="text-[13px] text-muted">
          {saved !== null ? `Saved ${saved} flags. ` : ""}Applies the next time Roblox launches.
        </span>
        <Button variant="glass" size="sm" disabled={!dirty} onClick={() => void save()}>
          Save
        </Button>
      </div>
    </SettingsSection>
  );
}

function ModsSection() {
  const qc = useQueryClient();
  const mods = useFishstrapMods(true);
  const [error, setError] = useState<string | null>(null);

  return (
    <SettingsSection title="Mods">
      <SettingRow title="Folder" description="Files here replace Roblox's own files at launch.">
        <div className="flex items-center gap-2">
          <Button
            variant="glass"
            size="sm"
            onClick={() =>
              void ipc
                .fishstrapOpenMods()
                .then(() => setError(null))
                .catch((e) => setError(toAppError(e).message))
            }
          >
            Open folder
          </Button>
          <Button
            variant="glass"
            size="sm"
            disabled={mods.isFetching}
            icon={<RefreshCw size={14} strokeWidth={1.75} className={mods.isFetching ? "spin" : undefined} />}
            onClick={() => void qc.invalidateQueries({ queryKey: FISHSTRAP_KEYS.mods })}
          >
            Refresh
          </Button>
        </div>
      </SettingRow>
      {mods.data && (
        <div className="flex flex-col gap-1 px-5 py-4">
          <div className="mb-1 truncate text-[13px] text-muted select-text">{mods.data.path}</div>
          {mods.data.entries.length === 0 && <div className="text-sm text-muted">No mods installed.</div>}
          {mods.data.entries.map((m) => (
            <div key={m.name} className="flex items-center justify-between gap-4 text-sm">
              <span className="min-w-0 truncate">{m.name}</span>
              <span className="shrink-0 text-muted">
                {m.isDir ? "Folder" : "File"} · {formatBytes(m.size)}
              </span>
            </div>
          ))}
        </div>
      )}
      <Err message={mods.isError ? mods.error.message : error} />
    </SettingsSection>
  );
}

function MaintenanceSection() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const cleanup = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await ipc.fishstrapCleanup();
      setResult(`Removed ${r.removed} items, freed ${formatBytes(r.freedBytes)}`);
      await qc.invalidateQueries({ queryKey: FISHSTRAP_KEYS.status });
    } catch (e) {
      setError(toAppError(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection title="Maintenance">
      <SettingRow
        title="Clean up old versions"
        description={result ?? "Deletes old Roblox versions and leftover downloads. Mods and settings are kept."}
      >
        <Button variant="glass" size="sm" disabled={busy} onClick={() => void cleanup()}>
          Clean up
        </Button>
      </SettingRow>
      <Err message={error} />
    </SettingsSection>
  );
}
