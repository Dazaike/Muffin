import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

// Single-colour icons: everything is `currentColor`, shapes cut out with even-odd holes, so the icon
// takes whatever text colour its parent has.
const base = { viewBox: "0 0 24 24", fill: "currentColor", "aria-hidden": true, focusable: false } as const;

/** Continue Playing: a game controller. */
export function GamepadIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path
        fillRule="evenodd"
        d="M7 7h10a5 5 0 0 1 4.9 4l.9 4.4a3 3 0 0 1-5.2 2.5L16 16.6H8l-1.6 1.3a3 3 0 0 1-5.2-2.5L2.1 11A5 5 0 0 1 7 7zm1.25 3h1.5v1.25H11v1.5H9.75V14h-1.5v-1.25H7v-1.5h1.25zM15 10.3a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8zm2 1.8a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8z"
      />
    </svg>
  );
}

/** Your Favorites: a heart. */
export function HeartIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 20.5s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.8a4.3 4.3 0 0 1 7.5 2.7c0 5.4-7.5 10-7.5 10z" />
    </svg>
  );
}

/** Trending Games: a flame with a cut-out core. */
export function FlameIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path
        fillRule="evenodd"
        d="M12 2c.4 3-1.2 4.6-2.8 6.4C7.6 10.2 6 12 6 14.6A6 6 0 0 0 12 21a6 6 0 0 0 6-6.4c0-2.2-1-3.9-2.2-5.2-.3 1.2-1 2-1.8 2.4C14.4 9 13.8 4.6 12 2zm0 19a3.4 3.4 0 0 1-3.4-3.5c0-1.7 1.1-2.6 2-3.7.3-.4.7-.9.9-1.6 1.6 1.3 3.9 3 3.9 5.3A3.4 3.4 0 0 1 12 21z"
      />
    </svg>
  );
}

/** Recommended for you: a big sparkle with two small ones. */
export function SparkleIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M10 3l1.9 5.1L17 10l-5.1 1.9L10 17l-1.9-5.1L3 10l5.1-1.9z" />
      <path d="M18 13.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z" />
      <path d="M19 3.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z" />
    </svg>
  );
}

/** Up-and-Coming: a rocket with a porthole. */
export function RocketIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path
        fillRule="evenodd"
        d="M12 2c3.5 2 5 5.5 5 9l-2 3H9l-2-3c0-3.5 1.5-7 5-9zm1.7 7a1.7 1.7 0 1 0-3.4 0 1.7 1.7 0 0 0 3.4 0z"
      />
      <path d="M7 12l-3 3 .5 3 3-1.5zM17 12l3 3-.5 3-3-1.5zM10.4 15.5h3.2L12 21z" />
    </svg>
  );
}
