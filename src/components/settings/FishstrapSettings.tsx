import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { inputClass } from "@/components/details/serverUi";
import { Switch } from "@/components/ui/Controls";
import { FISHSTRAP_KEYS, useFishstrapSettings } from "@/lib/fishstrap";
import {
  isDisabled,
  KNOWN_KEYS,
  keyLabel,
  type Group,
  type Item,
  type SchemaPage,
  type SettingsMap,
} from "@/lib/fishstrapSchema";
import { ipc, toAppError } from "@/lib/ipc";
import type { FishstrapSettingValue } from "@/lib/types";
import { SettingRow, SettingsSection } from "./SettingRow";

interface Editor {
  map: SettingsMap;
  commit: (key: string, value: FishstrapSettingValue) => Promise<void>;
  error: string | null;
  loadError: string | null;
}

/** Loads Settings.json and saves one key at a time, refetching afterwards. */
export function useSettingsEditor(): Editor {
  const qc = useQueryClient();
  const settings = useFishstrapSettings(true);
  const [error, setError] = useState<string | null>(null);

  const commit = async (key: string, value: FishstrapSettingValue) => {
    setError(null);
    try {
      await ipc.fishstrapSettingSet(key, value);
    } catch (e) {
      setError(`${keyLabel(key)}: ${toAppError(e).message}`);
    }
    await qc.invalidateQueries({ queryKey: FISHSTRAP_KEYS.settings });
    await qc.invalidateQueries({ queryKey: FISHSTRAP_KEYS.status });
  };

  const map: SettingsMap = Object.fromEntries((settings.data ?? []).map((s) => [s.key, s.value]));
  return { map, commit, error, loadError: settings.isError ? settings.error.message : null };
}

const commitOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
  if (e.key === "Enter") e.currentTarget.blur();
};

function NumberInput({ value, label, disabled, onCommit }: { value: number; label: string; disabled?: boolean; onCommit: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  const commit = () => {
    const n = Number(text);
    if (text.trim() !== "" && Number.isFinite(n) && n !== value && (!Number.isInteger(value) || Number.isInteger(n))) {
      onCommit(n);
    } else {
      setText(String(value));
    }
  };
  return (
    <input
      type="number"
      value={text}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={commitOnEnter}
      className={inputClass}
      aria-label={label}
    />
  );
}

function TextInput({ value, label, disabled, onCommit }: { value: string; label: string; disabled?: boolean; onCommit: (s: string) => void }) {
  const [text, setText] = useState(value);
  return (
    <input
      value={text}
      maxLength={512}
      disabled={disabled}
      spellCheck={false}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => (text !== value ? onCommit(text) : undefined)}
      onKeyDown={commitOnEnter}
      className={inputClass}
      aria-label={label}
    />
  );
}

function Readonly({ value }: { value: FishstrapSettingValue | undefined }) {
  const shown =
    value === undefined || value === null
      ? "Not set"
      : Array.isArray(value)
        ? value.length
          ? JSON.stringify(value)
          : "None"
        : String(value);
  return <span className="block max-w-[420px] truncate text-sm text-muted select-text">{shown}</span>;
}

function control(item: Item, ed: Editor): ReactNode {
  const v = ed.map[item.key];
  const disabled = isDisabled(item, ed.map);
  const set = (x: FishstrapSettingValue) => void ed.commit(item.key, x);
  // Re-key on the stored value so inputs resync after a refetch or a rejected edit.
  const rk = JSON.stringify(v);
  switch (item.kind) {
    case "switch":
      return typeof v === "boolean" ? (
        <Switch label={item.title} checked={item.invert ? !v : v} disabled={disabled} onChange={(on) => set(item.invert ? !on : on)} />
      ) : (
        <Readonly value={v} />
      );
    case "member": {
      if (!Array.isArray(v)) return <Readonly value={v} />;
      const on = v.includes(item.member);
      return (
        <Switch
          label={item.title}
          checked={on}
          disabled={disabled}
          onChange={(next) => set(next ? [...v, item.member] : v.filter((x) => x !== item.member))}
        />
      );
    }
    case "select": {
      if (typeof v !== "number" && typeof v !== "string") return <Readonly value={v} />;
      const known = item.options.some((o) => o.value === v);
      return (
        <select
          value={String(v)}
          disabled={disabled}
          aria-label={item.title}
          className={inputClass}
          onChange={(e) => {
            const picked = item.options.find((o) => String(o.value) === e.target.value);
            if (picked) set(picked.value);
          }}
        >
          {!known && <option value={String(v)}>{`Unknown (${String(v)})`}</option>}
          {item.options.map((o, i) => (
            <option key={i} value={String(o.value)}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }
    case "text":
      return typeof v === "string" ? <TextInput key={rk} value={v} label={item.title} disabled={disabled} onCommit={set} /> : <Readonly value={v} />;
    case "number":
      return typeof v === "number" ? <NumberInput key={rk} value={v} label={item.title} disabled={disabled} onCommit={set} /> : <Readonly value={v} />;
    case "readonly":
      return <Readonly value={v} />;
  }
}

export function ItemRow({ item, ed, hint }: { item: Item; ed: Editor; hint?: string }) {
  // Hide rows whose key this Fishstrap version doesn't have, so we never offer a setting that can't save.
  if (!(item.key in ed.map)) return null;
  const description = [hint, item.description].filter(Boolean).join(" · ");
  return (
    <SettingRow title={item.title} description={description || undefined}>
      {control(item, ed)}
    </SettingRow>
  );
}

function GroupView({ group, ed }: { group: Group; ed: Editor }) {
  const rows = group.items.filter((i) => i.key in ed.map);
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <SettingsSection title={group.title}>
        {group.description && <div className="px-5 py-3 text-[13px] text-muted">{group.description}</div>}
        {rows.map((item, i) => (
          <ItemRow key={`${item.key}:${i}`} item={item} ed={ed} />
        ))}
      </SettingsSection>
    </div>
  );
}

export function SchemaPageView({ page, ed }: { page: SchemaPage; ed: Editor }) {
  return (
    <>
      {page.groups.map((g, i) => (
        <GroupView key={i} group={g} ed={ed} />
      ))}
    </>
  );
}

/** Settings.json keys that no other page presents (e.g. added by newer Fishstrap versions). */
export function AdvancedView({ ed }: { ed: Editor }) {
  const keys = Object.keys(ed.map).filter((k) => !KNOWN_KEYS.has(k));
  const genericItem = (key: string): Item => {
    const v = ed.map[key];
    const title = keyLabel(key);
    if (typeof v === "boolean") return { kind: "switch", key, title };
    if (typeof v === "number") return { kind: "number", key, title };
    if (typeof v === "string") return { kind: "text", key, title };
    return { kind: "readonly", key, title };
  };
  return (
    <SettingsSection title="Other settings">
      {keys.length === 0 && <div className="px-5 py-4 text-sm text-muted">Every setting is already on another page.</div>}
      {keys.map((k) => (
        <ItemRow key={k} item={genericItem(k)} ed={ed} hint={k} />
      ))}
    </SettingsSection>
  );
}
