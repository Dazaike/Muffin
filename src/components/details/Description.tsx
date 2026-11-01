import { useState } from "react";

const LIMIT = 400;

/** Description with a "Show more" toggle beyond 400 characters. */
export function Description({ text, loading }: { text: string; loading: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > LIMIT;
  const shown = long && !expanded ? `${text.slice(0, LIMIT).trimEnd()}…` : text;

  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">About</h2>
      {loading && !text ? (
        <div className="flex flex-col gap-2" aria-hidden>
          <div className="skeleton h-4 w-full rounded" />
          <div className="skeleton h-4 w-11/12 rounded" />
          <div className="skeleton h-4 w-2/3 rounded" />
        </div>
      ) : text ? (
        <>
          <p className="text-sm leading-relaxed whitespace-pre-line text-fg/85 select-text">{shown}</p>
          {long && (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="focus-ring mt-2 cursor-pointer rounded text-sm font-medium text-accent hover:underline"
            >
              {expanded ? "Show less" : "Show more"}
            </button>
          )}
        </>
      ) : (
        <p className="text-sm text-muted">The creator hasn't provided a description.</p>
      )}
    </section>
  );
}
