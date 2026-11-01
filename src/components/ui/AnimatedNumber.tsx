import { formatCompact } from "@/lib/format";
import { useAnimatedNumber } from "@/lib/motion";

/** Number that springs to its new value without re-rendering. */
export function AnimatedNumber({
  value,
  format = formatCompact,
  className,
}: {
  value: number;
  format?: (n: number) => string;
  className?: string;
}) {
  const ref = useAnimatedNumber(value, format);
  return <span ref={ref} className={className} style={{ fontVariantNumeric: "tabular-nums" }} />;
}
