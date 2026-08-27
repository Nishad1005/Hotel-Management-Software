import type { Ionicons } from "@expo/vector-icons";
import type { Capability } from "@golai/domain";
import { useRouter } from "expo-router";
import { Card, Notice, Row, Screen } from "../components/ui";
import { memberCan } from "../lib/access";
import { useSession } from "../lib/session";

/**
 * The four screens you set up once and then rarely open again.
 *
 * They used to be a group of four rows in the sidebar called "Master data", sitting
 * permanently in a list otherwise made of daily work. A storekeeper and a security guard
 * spend their entire shift in The flow and Stock; the item master is something an
 * administrator touches when a new product arrives, and the bin tree is something they
 * touch when the store is rebuilt.
 *
 * Four rows of setup in a working list is four rows of noise on every screen, all day. One
 * row that leads here is the honest weight.
 *
 * Deliberately **not** a fix for the sidebar overflowing. It takes the count from sixteen
 * to thirteen, which happens to fit a 900px window with roughly ten pixels to spare — and
 * ten pixels is a coincidence the next nav item erases, not headroom. The overflow is
 * handled where it belongs, by the nav telling you when it has more to show. This exists
 * because configuration is not daily work, which is true at any viewport height.
 *
 * Every route here remains a first-class URL. This is a way in, not a container: `/items`
 * still works, still deep-links, and is still what the sidebar highlights when you are on
 * it.
 */

interface SetupEntry {
  href: string;
  capability: Capability;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  value: string;
}

const ENTRIES: SetupEntry[] = [
  {
    href: "/items",
    capability: "masters.edit",
    icon: "pricetags-outline",
    label: "Items",
    value: "What the property buys, and how each one is counted",
  },
  {
    href: "/admin/locations",
    capability: "masters.edit",
    icon: "map-outline",
    label: "Zones & bins",
    value: "Build the bin tree and print the labels",
  },
  {
    href: "/vendors",
    capability: "parties.edit",
    icon: "business-outline",
    label: "Vendors",
    value: "Who supplies, who launders, who takes the waste",
  },
  {
    href: "/admin/users",
    capability: "users.manage",
    icon: "people-outline",
    label: "People",
    value: "Who works here, and what they may do",
  },
];

export default function Setup() {
  const router = useRouter();
  const { activeProperty } = useSession();

  const roles = activeProperty?.roles ?? [];
  // Filtered per capability rather than shown-and-refused. A storekeeper who can edit
  // vendors but not people sees one row, not four with three dead ends.
  const entries = ENTRIES.filter((e) => memberCan(roles, e.capability));

  return (
    <Screen title="Setup" subtitle="Configured once, then left alone" onBack={() => router.back()}>
      {entries.length === 0 ? (
        <Notice
          icon="lock-closed-outline"
          title="Nothing here for your role"
          body="Setting up items, zones, vendors and people is an administrator's job. Your work is on the flow and stock screens."
        />
      ) : (
        <Card padded={false}>
          {entries.map((e, i) => (
            <Row
              key={e.href}
              icon={e.icon}
              label={e.label}
              value={e.value}
              divider={i < entries.length - 1}
              onPress={() => router.push(e.href)}
            />
          ))}
        </Card>
      )}
    </Screen>
  );
}
