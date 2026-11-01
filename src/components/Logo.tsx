/** Muffin app mark (same artwork as src-tauri/icons-src/muffin.svg and the splash). */
export function Logo({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" className={className} aria-hidden>
      <rect width="1024" height="1024" rx="232" fill="#1c1c24" />
      <path
        d="M512 214c-142 0-254 96-270 230-22 8-36 28-36 52 0 30 24 54 54 54h504c30 0 54-24 54-54 0-24-14-44-36-52C766 310 654 214 512 214Z"
        fill="#fff"
      />
      <path d="M262 586h500l-48 224c-6 28-30 46-58 46H368c-28 0-52-18-58-46Z" fill="#fff" opacity=".92" />
      <path d="M398 612l16 220M512 612v220M626 612l-16 220" stroke="#1c1c24" strokeWidth="22" strokeLinecap="round" opacity=".4" />
    </svg>
  );
}
