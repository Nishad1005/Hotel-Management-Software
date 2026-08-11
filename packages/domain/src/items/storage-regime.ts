/**
 * Where stock may physically live. Chilled goods cannot be put away to an ambient bin;
 * PRD section 4 Gate 6 makes that a hard block with no override.
 */
export const STORAGE_REGIMES = ["AMBIENT", "CHILLED", "FROZEN"] as const;

export type StorageRegime = (typeof STORAGE_REGIMES)[number];
