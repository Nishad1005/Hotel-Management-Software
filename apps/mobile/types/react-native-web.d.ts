import "react-native";

/**
 * What react-native-web's `Pressable` actually reports, declared once.
 *
 * RNW builds `{ hovered, focused, pressed }` and passes all three to the `style` and
 * `children` callbacks — see `react-native-web/dist/exports/Pressable/index.js`, which
 * assembles `interactionState` from its own hover and focus responders. React Native's
 * types describe only `pressed`, because on a device the other two have no meaning.
 *
 * The cost of that gap was not theoretical. Every list row in this app that wanted a hover
 * state reimplemented one — `useState`, two handlers, a re-render per row — to recompute
 * something the platform had already worked out and was passing in. Most rows then skipped
 * it, so twelve list screens had no hover at all on a product whose primary delivery target
 * is a browser.
 *
 * Augmenting the interface is the honest fix. It is not claiming a capability that does not
 * exist; it is describing one that does. On native both are simply always `false`, which is
 * the correct answer there, so nothing conditional is needed at a call site.
 */
declare module "react-native" {
  interface PressableStateCallbackType {
    /** Web only. Always `false` on a device, which has no pointer to hover with. */
    hovered: boolean;
    /** Web only. Keyboard focus, for a control drawing its own focus ring. */
    focused: boolean;
  }
}
