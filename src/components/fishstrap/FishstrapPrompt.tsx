import { LoaderCircle } from "lucide-react";
import { Modal, ModalButton } from "@/components/ui/Modal";
import { useFishstrapPrompt } from "@/store/fishstrapPrompt";

/** Asks before launching whether to install Fishstrap or keep Roblox's stock launcher. */
export function FishstrapPrompt() {
  const phase = useFishstrapPrompt((s) => s.phase);
  const answer = useFishstrapPrompt((s) => s.answer);
  const installing = phase === "installing";

  return (
    <Modal
      open={phase !== "closed"}
      onClose={() => answer("dismiss")}
      title="Install Fishstrap?"
      dismissable={!installing}
      hideClose={installing}
    >
      {installing ? (
        <div className="flex items-center gap-3 text-sm text-muted">
          <LoaderCircle size={18} strokeWidth={2} className="spin shrink-0 text-accent" />
          Downloading and installing Fishstrap…
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2 text-sm text-muted">
            <p>
              Fishstrap is a Roblox launcher that keeps Roblox updated, lets you change FastFlags and mods, and shows
              launch progress right here in Muffin.
            </p>
            <p>
              Muffin downloads it from Fishstrap's official GitHub releases and installs it quietly. If you'd rather not,
              Muffin launches the standard Roblox from roblox.com instead. You can change this later in Settings →
              Fishstrap.
            </p>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <ModalButton onClick={() => answer("deny")}>Use Roblox's default</ModalButton>
            <ModalButton primary autoFocus onClick={() => answer("install")}>
              Install Fishstrap
            </ModalButton>
          </div>
        </>
      )}
    </Modal>
  );
}
