import type { ReactNode } from "react";
import { motion, type HTMLMotionProps } from "motion/react";
import { cn } from "@/lib/cn";
import { useMotionPrefs } from "@/lib/motion";

export type ButtonVariant = "primary" | "ghost" | "glass" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  children?: ReactNode;
}

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white font-semibold transition-[filter] hover:brightness-110",
  ghost: "bg-transparent text-fg hover:bg-white/6",
  glass: "glass text-fg hover:bg-white/10",
  danger: "bg-danger/90 text-white hover:bg-danger font-semibold",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-[10px]",
  md: "h-10 px-4 text-sm gap-2 rounded-[12px]",
  lg: "h-12 px-6 text-base gap-2.5 rounded-[14px]",
};

export function Button({ variant = "ghost", size = "md", icon, className, children, disabled, ...rest }: ButtonProps) {
  const m = useMotionPrefs();
  return (
    <motion.button
      type="button"
      whileTap={disabled ? undefined : { scale: 0.96 }}
      whileHover={disabled || !m.full ? undefined : { scale: 1.03 }}
      transition={m.spring}
      disabled={disabled}
      className={cn(
        "focus-ring inline-flex shrink-0 cursor-pointer select-none items-center justify-center whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </motion.button>
  );
}
