import type { KeyboardEventHandler, Ref } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/cn";

export interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  inputRef?: Ref<HTMLInputElement>;
  autoFocus?: boolean;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  onFocus?: () => void;
  onBlur?: () => void;
  className?: string;
  inputClassName?: string;
}

/** Pill text input with a search icon and a clear button. */
export function SearchField({
  value,
  onChange,
  placeholder,
  inputRef,
  autoFocus,
  onKeyDown,
  onFocus,
  onBlur,
  className,
  inputClassName,
}: SearchFieldProps) {
  return (
    <div className={cn("relative", className)}>
      <Search size={17} strokeWidth={1.75} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted" />
      <input
        ref={inputRef}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder={placeholder}
        aria-label={placeholder}
        spellCheck={false}
        autoComplete="off"
        className={cn(
          "focus-ring h-10 w-full rounded-full border border-white/8 bg-white/5 pr-10 pl-10 text-sm transition-colors outline-none placeholder:text-muted focus:border-accent/60 focus:bg-white/8",
          inputClassName,
        )}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChange("")}
          className="focus-ring absolute top-1/2 right-2.5 flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-white/10 hover:text-fg"
        >
          <X size={14} strokeWidth={1.75} />
        </button>
      )}
    </div>
  );
}
