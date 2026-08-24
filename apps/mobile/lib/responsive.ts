import { useWindowDimensions } from "react-native";
import { breakpoints } from "../theme";

/**
 * How much room there is.
 *
 * The app had none of this — not one `useWindowDimensions`, `Dimensions` or breakpoint
 * anywhere — so it rendered an identical tree at 375px and at 1920px, and the only thing
 * that changed on a desktop was how much empty background sat either side of a 720px
 * column. Web is the primary delivery target and the pilot runs on a laptop in the office
 * and phones on the floor, so that was never going to be good enough.
 *
 * `useWindowDimensions` rather than `Dimensions.get`: it re-renders on browser resize and
 * on device rotation, which `Dimensions.get` does not. No dependency, and it works on
 * native too.
 */

export type Breakpoint = "compact" | "expanded";

/**
 * Two values, not five.
 *
 * There is exactly one question worth asking — is there room for a sidebar beside the
 * content — and answering it with an `sm/md/lg/xl/2xl` ladder invites twenty-five screens
 * to each pick a different rung. A ladder is a web-framework habit; this is a decision.
 */
export function useBreakpoint(): Breakpoint {
  const { width } = useWindowDimensions();
  return width >= breakpoints.expanded ? "expanded" : "compact";
}

/** True when the sidebar is showing and the content sits beside it. */
export function useIsExpanded(): boolean {
  return useBreakpoint() === "expanded";
}

/**
 * Enough width that a list row can spread its metadata into real columns.
 *
 * Separate from `expanded` because they are different thresholds for different reasons:
 * a sidebar needs about 1024, and a table-like row needs considerably more before columns
 * beat a single line of `·`-separated metadata.
 */
export function useIsWide(): boolean {
  const { width } = useWindowDimensions();
  return width >= breakpoints.wide;
}
