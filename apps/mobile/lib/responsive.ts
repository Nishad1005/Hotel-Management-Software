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

/*
 * There was a `useIsWide()` here, reading `breakpoints.wide` for list rows that could
 * afford real columns. It was written speculatively and never called by anything, so it
 * has gone: an unused breakpoint is an invitation to start answering a question nobody
 * has asked yet, which is exactly how a two-value system becomes a five-value one.
 *
 * `breakpoints.wide` stays in the theme — the list-column work is real and still to come.
 * The hook comes back when something calls it.
 */

/** True when the sidebar is showing and the content sits beside it. */
export function useIsExpanded(): boolean {
  return useBreakpoint() === "expanded";
}
