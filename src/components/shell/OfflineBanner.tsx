import { AnimatePresence, motion } from "motion/react";
import { WifiOff } from "lucide-react";
import { useMotionPrefs } from "@/lib/motion";
import { useOnline } from "@/lib/useOnline";

export function OfflineBanner() {
  const online = useOnline();
  const m = useMotionPrefs();
  return (
    <AnimatePresence initial={false}>
      {!online && (
        <motion.div
          key="offline"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={m.fast}
          className="relative z-20 overflow-hidden"
          role="status"
        >
          <div className="page-pad">
            <div className="flex items-center gap-2 rounded-[12px] bg-amber-400/12 px-3.5 py-2 text-[13px] text-amber-200">
              <WifiOff size={15} strokeWidth={1.75} />
              You're offline — showing saved data
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
