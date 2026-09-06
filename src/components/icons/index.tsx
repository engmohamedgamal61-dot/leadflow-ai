import type { ReactNode, SVGProps } from "react";

/**
 * LeadFlow's dashboard icon set — a small, self-contained collection of
 * stroke-based line icons (24px grid, 1.5px stroke, rounded joins), matching
 * the hand-rolled SVGs already used in the sidebar/composer. No runtime
 * dependency: adding an icon library for ~20 glyphs isn't worth the weight,
 * and every icon here is a pure function component that renders identically on
 * the server and the client.
 *
 * Sizing: icons default to `1em` so they track surrounding text; pass
 * `className="h-4 w-4"` (etc.) to pin a size. Colour comes from `currentColor`.
 * They're decorative — `aria-hidden` is set here — so give the labelled element
 * the accessible name.
 */

export type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

/* ── Navigation / section icons ─────────────────────────────────────────── */

export function DashboardIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
    </Icon>
  );
}

export function LeadsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="M6.5 16c.6-1.7 4.4-1.7 5 0" />
      <path d="M15 9.5h3.5M15 13h3.5" />
    </Icon>
  );
}

export function FollowUpIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5V12l3 1.8" />
    </Icon>
  );
}

export function AppointmentIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="4.5" width="18" height="16.5" rx="2" />
      <path d="M8 2.5v4M16 2.5v4M3 10h18" />
    </Icon>
  );
}

export function RecoveryIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
      <path d="M3 4.5V9h4.5" />
    </Icon>
  );
}

export function AiAgentIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3.2l1.9 4.4 4.4 1.9-4.4 1.9L12 15.8l-1.9-4.4L5.7 9.5l4.4-1.9Z" />
      <path d="M18.5 14.5l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8Z" />
    </Icon>
  );
}

export function IntegrationsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 2.5v5M15 2.5v5" />
      <path d="M6 7.5h12v3.5a6 6 0 0 1-12 0Z" />
      <path d="M12 17v4.5" />
    </Icon>
  );
}

export function TeamIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 20c0-3 2.5-5.2 5.5-5.2s5.5 2.2 5.5 5.2" />
      <path d="M16 5.3a3 3 0 0 1 0 5.4M17 14.9c2.3.5 3.8 2.5 3.8 5.1" />
    </Icon>
  );
}

export function WidgetIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18" />
      <path d="M6.5 6.5h.01M9.5 6.5h.01" />
      <path d="M9 13l-1.8 1.8L9 16.6M15 13l1.8 1.8L15 16.6" />
    </Icon>
  );
}

export function ActivityIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 12h4l2.5 7 5-14 2.5 7H21" />
    </Icon>
  );
}

export function ReadinessIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M21.8 10.3A10 10 0 1 1 16.5 3.4" />
      <path d="M8.5 11.5l3 3 9.5-9.7" />
    </Icon>
  );
}

export function HealthIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3.2l7 2.8v5.6c0 4.4-3 7.6-7 8.6-4-1-7-4.2-7-8.6V6Z" />
      <path d="M8.5 12l2.2 2.2L15.5 9.5" />
    </Icon>
  );
}

export function WorkflowIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="14.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
      <path d="M9.5 7.25h4a2.5 2.5 0 0 1 2.5 2.5v3.75" />
    </Icon>
  );
}

/* ── Workflow-map node icons ───────────────────────────────────────────── */

export function SourceIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.6 3 2.6 15 0 18M12 3c-2.6 3-2.6 15 0 18" />
    </Icon>
  );
}

export function QualifyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 5h17l-6.6 7.6V19l-3.8 1.8v-8.2Z" />
    </Icon>
  );
}

export function OpportunityIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 16.5l5.5-5.5 3.5 3.5L21 5" />
      <path d="M16 5h5v5" />
    </Icon>
  );
}

export function NextActionIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function HandoffIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3.5" />
      <path d="M6 6l3.5 3.5M14.5 14.5L18 18M18 6l-3.5 3.5M9.5 14.5L6 18" />
    </Icon>
  );
}

/** Flow connector — points right; flip with `rtl:-scale-x-100` in horizontal layouts. */
export function ArrowIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 12h15M13 6l6 6-6 6" />
    </Icon>
  );
}

/* ── Chrome (top bar, menus, misc) ─────────────────────────────────────── */

export function SearchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.6-3.6" />
    </Icon>
  );
}

export function BellIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 9a6 6 0 0 1 12 0c0 5 1.5 6.5 2 7H4c.5-.5 2-2 2-7Z" />
      <path d="M9.5 20a2.5 2.5 0 0 0 5 0" />
    </Icon>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 9l6 6 6-6" />
    </Icon>
  );
}

export function ChatIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 5h16v11H8l-4 4V5Z" />
      <path d="M8 9.5h8M8 12.5h5" />
    </Icon>
  );
}

export function BoltIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
    </Icon>
  );
}

export function CalendarDateIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="4.5" width="18" height="16.5" rx="2" />
      <path d="M8 2.5v4M16 2.5v4M3 10h18" />
      <path d="M7.5 14h2v2h-2z" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function ExternalLinkIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14 4h6v6M20 4l-9 9" />
      <path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
    </Icon>
  );
}

export function TrendUpIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5l6 8H6l6-8Z" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function TrendDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 19l6-8H6l6 8Z" fill="currentColor" stroke="none" />
    </Icon>
  );
}
