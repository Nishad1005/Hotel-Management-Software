import type { Ionicons } from "@expo/vector-icons";
import type { MembershipRole } from "@golai/db";
import { capabilitiesForMembership, ROUTE_CAPABILITY } from "./access";

/**
 * What is in the navigation, and who sees it.
 *
 * `ROUTE_CAPABILITY` and `capabilitiesForMembership` have existed since Phase 1 with
 * **zero consumers** — nothing in the app imported either. So the promise written at the
 * top of `packages/domain/src/access/capabilities.ts`, that "a security guard on a night
 * shift sees four large buttons instead of nineteen", was true of the design and of
 * nothing that shipped. This is the first thing that can keep it.
 *
 * It is worth checking what that produces. A SECURITY membership grants exactly
 * `gate.capture` and `gate.pass`, so a guard sees Home, New arrival, Gate out — three
 * items. A STOREKEEPER sees the flow without gate capture, plus stock and the reports.
 * An owner sees everything. None of that is hard-coded here; it falls out of the
 * capability table, which is the reason to route through it rather than list the items
 * per role.
 *
 * This is still ergonomics, not security — it runs on the device. The boundary is RLS and
 * the role check inside every write function. What it buys is that nobody is offered a
 * screen that will refuse them at the end of it.
 */

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

export interface NavItem {
  href: string;
  /**
   * Other routes this item stands for.
   *
   * A hub row is visible if the user can reach *any* of them, and stays lit while they are
   * on *any* of them — so "Setup" highlights on `/items` and does not appear at all for
   * somebody who may edit none of the four. Without this, a hub would need its own
   * capability, which would either hide it from people who can use half of it or offer it
   * to people who can use none.
   */
  covers?: string[];
  /**
   * The `ROUTE_CAPABILITY` key for this route — the path without its leading slash.
   *
   * Kept separate from `href` rather than derived, because the two genuinely differ for
   * dynamic routes, and a silent mismatch here would show a guard a screen that then
   * refuses them.
   */
  segment: string;
  label: string;
  icon: IoniconName;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

/**
 * Ordered by the working day, not by the org chart.
 *
 * The home screen listed "Master data" — a monthly task — above "The flow", which is the
 * actual job, in a file whose own comment argued screens should be ordered "by who they
 * are waiting on". This is that ordering, applied.
 */
const GROUPS: NavGroup[] = [
  {
    title: "",
    items: [{ href: "/", segment: "", label: "Home", icon: "home-outline" }],
  },
  {
    title: "The flow",
    items: [
      { href: "/gate/new", segment: "gate/new", label: "New arrival", icon: "car-outline" },
      { href: "/receive", segment: "receive", label: "Receive goods", icon: "clipboard-outline" },
      {
        href: "/putaway",
        segment: "putaway",
        label: "Put away",
        icon: "file-tray-stacked-outline",
      },
      { href: "/issue", segment: "issue", label: "Issue", icon: "exit-outline" },
      { href: "/dispatch", segment: "dispatch", label: "Send out", icon: "albums-outline" },
      {
        href: "/gate-out",
        segment: "gate-out",
        label: "Gate out",
        icon: "shield-checkmark-outline",
      },
    ],
  },
  {
    title: "Stock",
    items: [
      { href: "/stock", segment: "stock", label: "In the store", icon: "cube-outline" },
      {
        href: "/perishables",
        segment: "perishables",
        label: "Expiring",
        icon: "hourglass-outline",
      },
      {
        href: "/stock/opening",
        segment: "stock/opening",
        label: "Opening stock",
        icon: "download-outline",
      },
    ],
  },
  {
    title: "Compliance",
    items: [
      {
        href: "/registers",
        segment: "registers",
        label: "FSSAI registers",
        icon: "document-text-outline",
      },
      {
        href: "/receipts",
        segment: "receipts",
        label: "Goods receipts",
        icon: "documents-outline",
      },
    ],
  },
  {
    // Untitled: one row does not need a heading announcing it.
    title: "",
    items: [
      {
        href: "/setup",
        segment: "setup",
        covers: ["items", "admin/locations", "vendors", "admin/users"],
        label: "Setup",
        icon: "settings-outline",
      },
    ],
  },
];

/**
 * The vendor console, which is ours rather than a property's.
 *
 * Deliberately outside `GROUPS` and outside `ROUTE_CAPABILITY`: it is not granted by any
 * property role, and putting it in the capability table would imply it could be.
 */
const PLATFORM: NavGroup = {
  title: "Platform",
  items: [
    { href: "/platform", segment: "platform", label: "Customers", icon: "briefcase-outline" },
  ],
};

export function navigationFor(
  roles: readonly MembershipRole[],
  isPlatformAdmin: boolean,
): NavGroup[] {
  const granted = capabilitiesForMembership(roles);

  const groups = GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      // A hub is worth showing when any one of the screens behind it is.
      if (item.covers) return item.covers.some((seg) => granted.has(ROUTE_CAPABILITY[seg]!));
      const needed = ROUTE_CAPABILITY[item.segment];
      // No entry means the route is open to anyone signed in — the home screen. Absence
      // is deliberate rather than an oversight, so it is treated as such.
      return needed === undefined || granted.has(needed);
    }),
  })).filter((group) => group.items.length > 0);

  return isPlatformAdmin ? [...groups, PLATFORM] : groups;
}

/**
 * Whether a nav item is the page currently open.
 *
 * `startsWith` so that `/receipts/abc-123` keeps "Goods receipts" lit, and an exact match
 * for `/` or Home would be lit on every screen in the app. Longest match wins, which is
 * what stops `/stock/opening` also lighting `/stock`.
 */
export function activeHref(pathname: string, groups: readonly NavGroup[]): string | null {
  let best: string | null = null;
  for (const group of groups) {
    for (const item of group.items) {
      const hit =
        item.href === "/"
          ? pathname === "/"
          : pathname.startsWith(item.href) ||
            (item.covers?.some((seg) => pathname.startsWith("/" + seg)) ?? false);
      if (hit && (best === null || item.href.length > best.length)) best = item.href;
    }
  }
  return best;
}
