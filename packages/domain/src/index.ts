/**
 * @golai/domain — the rules, with zero I/O.
 *
 * Everything here must produce identical results on an offline device and on the
 * server. No network, no filesystem, no database, no clock, no environment access:
 * anything time-dependent takes a timestamp as a parameter.
 *
 * See docs/decisions/0009-domain-package-has-no-io.md.
 */

export * from "./stock/index";
export * from "./gate/index";
export * from "./items/index";
