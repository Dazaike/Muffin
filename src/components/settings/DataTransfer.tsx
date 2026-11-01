import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Controls";
import { Modal } from "@/components/ui/Modal";
import type { ImportMode, ImportPreview, ImportResult, SectionPreview } from "@/lib/dataTypes";
import { ipc, toAppError } from "@/lib/ipc";
import { reloadLibraryData, reloadSettings } from "@/store/reload";
import { toast } from "@/store/ui";
import { SettingRow, SettingsSection } from "./SettingRow";

const MODES = [
  { value: "merge", label: "Merge" },
  { value: "replace", label: "Replace" },
] as const;

const MODE_HELP: Record<ImportMode, string> = {
  merge: "Adds what's missing. Games and servers you already have keep their current flags, order and counts.",
  replace:
    "Deletes your current library, history, searches, private-server bookmarks and finished playtime first, then loads the file.",
};

function PreviewRow({ label, s, mode }: { label: string; s: SectionPreview; mode: ImportMode }) {
  return (
    <tr className="border-t border-white/6">
      <td className="py-2 pr-4">{label}</td>
      <td className="py-2 pr-4 text-right tabular-nums">{s.total.toLocaleString()}</td>
      <td className="py-2 text-right tabular-nums text-muted">
        {mode === "merge" ? `${s.new.toLocaleString()} new` : "all replaced"}
      </td>
    </tr>
  );
}

function summarize(r: ImportResult, mode: ImportMode): string {
  const added = r.library.added + r.history.added + r.searches.added + r.privateServers.added + r.playtime.added;
  const parts = [
    `${r.library.added} games`,
    `${r.history.added} history`,
    `${r.privateServers.added} servers`,
    `${r.playtime.added} sessions`,
  ];
  if (mode === "merge" && added === 0 && r.settingsApplied === 0) return "Nothing new to import";
  return `Imported ${parts.join(", ")}${r.settingsApplied > 0 ? `, ${r.settingsApplied} settings` : ""}`;
}

export function DataTransferSection({ onChanged }: { onChanged: () => void }) {
  const qc = useQueryClient();
  const [exporting, setExporting] = useState(false);
  const [picking, setPicking] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mode, setMode] = useState<ImportMode>("merge");
  const [applying, setApplying] = useState(false);

  const doExport = async () => {
    setExporting(true);
    try {
      const r = await ipc.exportData();
      if (r) toast.success(`Exported ${r.library} games, ${r.history} history entries and ${r.playtime} sessions to ${r.fileName}`);
    } catch (e) {
      toast.error(`Couldn't export: ${toAppError(e).message}`);
    } finally {
      setExporting(false);
    }
  };

  const pick = async () => {
    setPicking(true);
    try {
      const p = await ipc.importPick();
      if (p) {
        setMode("merge");
        setPreview(p);
      }
    } catch (e) {
      toast.error(toAppError(e).message);
    } finally {
      setPicking(false);
    }
  };

  const dismiss = () => {
    if (applying) return;
    setPreview(null);
    void ipc.importDiscard().catch(() => undefined);
  };

  const apply = async () => {
    setApplying(true);
    try {
      const r = await ipc.importApply(mode);
      await Promise.all([reloadLibraryData(), reloadSettings()]);
      void qc.invalidateQueries({ queryKey: ["playtime"] });
      onChanged();
      toast.success(summarize(r, mode));
      setApplying(false);
      setPreview(null);
    } catch (e) {
      setApplying(false);
      toast.error(`Import failed, nothing was changed: ${toAppError(e).message}`);
    }
  };

  return (
    <>
      <SettingsSection title="Backup & restore">
        <SettingRow
          title="Export Muffin data"
          description="Saves your library, favorites, pins and order, play history, searches, private-server bookmarks, playtime and settings to a JSON file. Never includes Roblox sign-ins. Private-server links in the file can be used to join those servers, so keep it private."
        >
          <Button variant="glass" size="sm" icon={<Download size={15} strokeWidth={1.75} />} disabled={exporting} onClick={() => void doExport()}>
            {exporting ? "Exporting…" : "Export…"}
          </Button>
        </SettingRow>
        <SettingRow
          title="Import Muffin data"
          description="Reads a file exported by Muffin. You'll see what it contains before anything changes."
        >
          <Button variant="glass" size="sm" icon={<Upload size={15} strokeWidth={1.75} />} disabled={picking} onClick={() => void pick()}>
            {picking ? "Opening…" : "Import…"}
          </Button>
        </SettingRow>
      </SettingsSection>

      <Modal open={preview !== null} onClose={dismiss} title="Import Muffin data" widthClass="max-w-lg" dismissable={!applying}>
        {preview && (
          <div className="flex flex-col gap-5">
            <p className="text-sm text-muted">
              <span className="font-medium text-fg">{preview.fileName}</span> · exported{" "}
              {new Date(preview.exportedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
            </p>

            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] font-medium tracking-wide text-muted uppercase">
                  <th className="pb-2 font-medium">In the file</th>
                  <th className="pb-2 text-right font-medium">Count</th>
                  <th className="pb-2 text-right font-medium">{mode === "merge" ? "Would add" : ""}</th>
                </tr>
              </thead>
              <tbody>
                <PreviewRow label="Library games" s={preview.library} mode={mode} />
                <PreviewRow label="Play history" s={preview.history} mode={mode} />
                <PreviewRow label="Searches" s={preview.searches} mode={mode} />
                <PreviewRow label="Private servers" s={preview.privateServers} mode={mode} />
                <PreviewRow label="Playtime sessions" s={preview.playtime} mode={mode} />
                <PreviewRow label="Settings" s={preview.settings} mode={mode} />
              </tbody>
            </table>
            {preview.settingsIgnored > 0 && (
              <p className="-mt-3 text-xs text-muted">
                {preview.settingsIgnored} setting{preview.settingsIgnored === 1 ? "" : "s"} in the file can't be imported (unknown,
                invalid, or specific to the PC they came from) and will be skipped.
              </p>
            )}

            <div className="flex flex-col gap-2">
              <Segmented options={[...MODES]} value={mode} onChange={setMode} />
              <p className="text-[13px] text-muted">{MODE_HELP[mode]}</p>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" disabled={applying} onClick={dismiss}>
                Cancel
              </Button>
              <Button variant={mode === "replace" ? "danger" : "primary"} disabled={applying} onClick={() => void apply()}>
                {applying ? "Importing…" : mode === "replace" ? "Replace my data" : "Merge into my data"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
