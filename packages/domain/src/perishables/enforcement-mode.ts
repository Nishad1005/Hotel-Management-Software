/**
 * Every check carries a mode, not an on/off flag. PRD section 8.
 *
 * Ships RECORD_ONLY with no UI to change it. The property ratchets rules upward later
 * as a dated management decision, never as a deployment default — and the field had to
 * exist from day one because retrofitting it is a rewrite (CLAUDE.md rule 9).
 */
export const ENFORCEMENT_MODES = ["RECORD_ONLY", "WARN", "BLOCK"] as const;

export type EnforcementMode = (typeof ENFORCEMENT_MODES)[number];
