import type {SVGProps} from "react";

/**
 * Inline SVG icon set.
 *
 * Hand-drawn on a 16px grid at 1.5 stroke rather than pulling an icon package:
 * the console needs about a dozen glyphs, and every one here corresponds to a
 * function in the product. Nothing decorative.
 */

type IconProps = SVGProps<SVGSVGElement> & {size?: number};

function Svg({size = 16, children, ...rest}: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const Icon = {
  Overview: (p: IconProps) => (
    <Svg {...p}>
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <rect x="9" y="2" width="5" height="5" rx="1" />
      <rect x="2" y="9" width="5" height="5" rx="1" />
      <rect x="9" y="9" width="5" height="5" rx="1" />
    </Svg>
  ),
  Agent: (p: IconProps) => (
    <Svg {...p}>
      <rect x="1.75" y="3" width="12.5" height="10" rx="1.5" />
      <path d="M4.5 6.5 6.5 8l-2 1.5" />
      <path d="M8.5 10h3" />
    </Svg>
  ),
  Policy: (p: IconProps) => (
    <Svg {...p}>
      <path d="M8 1.75 13.25 4v4c0 3-2.2 5.3-5.25 6.25C4.95 13.3 2.75 11 2.75 8V4z" />
      <path d="M5.75 8 7.25 9.5l3-3.25" />
    </Svg>
  ),
  Activity: (p: IconProps) => (
    <Svg {...p}>
      <path d="M1.75 8h2.5l1.5-4 2.5 8 1.75-4h4.25" />
    </Svg>
  ),
  Services: (p: IconProps) => (
    <Svg {...p}>
      <path d="M8 1.75 14 5v6l-6 3.25L2 11V5z" />
      <path d="M2 5l6 3.25L14 5M8 8.25v6" />
    </Svg>
  ),
  Wallet: (p: IconProps) => (
    <Svg {...p}>
      <rect x="1.75" y="3.5" width="12.5" height="9" rx="1.5" />
      <path d="M1.75 6.5h12.5" />
      <circle cx="11.25" cy="9.5" r="0.85" fill="currentColor" stroke="none" />
    </Svg>
  ),
  Check: (p: IconProps) => (
    <Svg {...p}>
      <path d="M3 8.5 6.25 11.75 13 5" />
    </Svg>
  ),
  Deny: (p: IconProps) => (
    <Svg {...p}>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M5.75 5.75l4.5 4.5M10.25 5.75l-4.5 4.5" />
    </Svg>
  ),
  Alert: (p: IconProps) => (
    <Svg {...p}>
      <path d="M8 2.25 14.5 13.5h-13z" />
      <path d="M8 6.5v3" />
      <circle cx="8" cy="11.6" r="0.7" fill="currentColor" stroke="none" />
    </Svg>
  ),
  Clock: (p: IconProps) => (
    <Svg {...p}>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 4.5V8l2.25 1.5" />
    </Svg>
  ),
  External: (p: IconProps) => (
    <Svg {...p}>
      <path d="M6.5 3h-3.25v9.75H13V9.5" />
      <path d="M9.5 2.75H13.25V6.5M13.25 2.75 7.75 8.25" />
    </Svg>
  ),
  Chevron: (p: IconProps) => (
    <Svg {...p}>
      <path d="M6 3.5 10.5 8 6 12.5" />
    </Svg>
  ),
  Lock: (p: IconProps) => (
    <Svg {...p}>
      <rect x="3.25" y="7" width="9.5" height="7" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </Svg>
  ),
  Chain: (p: IconProps) => (
    <Svg {...p}>
      <path d="M6.5 9.5 9.5 6.5" />
      <path d="M7.25 4.75 8.5 3.5a2.65 2.65 0 0 1 3.75 3.75l-1.25 1.25" />
      <path d="M8.75 11.25 7.5 12.5a2.65 2.65 0 0 1-3.75-3.75L5 7.5" />
    </Svg>
  ),
  Server: (p: IconProps) => (
    <Svg {...p}>
      <rect x="2" y="2.5" width="12" height="4.5" rx="1" />
      <rect x="2" y="9" width="12" height="4.5" rx="1" />
      <path d="M4.5 4.75h.01M4.5 11.25h.01" />
    </Svg>
  ),
  Refresh: (p: IconProps) => (
    <Svg {...p}>
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
      <path d="M13.75 2.5V5.5H10.75" />
    </Svg>
  ),
  Menu: (p: IconProps) => (
    <Svg {...p}>
      <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
    </Svg>
  ),
  Close: (p: IconProps) => (
    <Svg {...p}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </Svg>
  ),
  Send: (p: IconProps) => (
    <Svg {...p}>
      <path d="M14 2 7 9" />
      <path d="M14 2 9.5 14 7 9 2 6.5z" />
    </Svg>
  ),
};
