# Suggested prompts (one phase per session)

Before the first phase, once:
"Read docs/ui-redesign/living-floor-plan/LIVING_FLOOR_PLAN_SPEC.md fully, open living-floor-plan-demo-v7.html in the same folder and read its <script> as the reference implementation, then append the Amendment from the spec's last section to docs/ui-redesign/UI_REDESIGN_BRIEF.md. Do nothing else."

Then per phase:
"Implement phase LFP-1 only, per LIVING_FLOOR_PLAN_SPEC.md. The demo file is the reference implementation — port its decisions, don't redesign them. Stop when the phase's Done criteria pass, including typecheck."
(...repeat for LFP-2 through LFP-5, one at a time.)

If Claude Code proposes deviating from the demo's behavior, require it to state the deviation and the reason before proceeding, and record accepted deviations in an Amendments section of the spec.
