# Golai — Material Flow Control

Stock control for hotels and restaurants, with FSSAI compliance built into the flow rather than bolted alongside it.

Material is tracked from the security gate, through receiving and quality inspection, into storage zones, out to departments, and eventually off the property. Because that flow already captures vendor, batch, temperature, expiry and disposal, the FSSAI registers are a by-product of it. Nothing is entered twice.

**Reference deployment:** Voyage The Solitaire Bliss, Tinsukia, Assam.

---

## Start here

| Document | What it is |
|---|---|
| **[CLAUDE.md](CLAUDE.md)** | Standing context: the non-negotiables, stack, conventions, glossary. **Read this first.** |
| [docs/PRD_PAR_Golai_Material_Flow_Rev02.md](docs/PRD_PAR_Golai_Material_Flow_Rev02.md) | The requirements. Source of truth. |
| [docs/decisions/](docs/decisions/) | Architecture decision records — why things are the way they are. |

## The control this exists to provide

> Every Gate Entry must resolve to a GRN. Every Gate Pass must resolve to a Dispatch Note.

An open Gate Entry with no GRN means goods came through the gate and never reached the store. That single reconciliation is the most valuable thing in the product, and it only works because Security captures in the app, at the gate, independently of the storekeeper.

## Status

**Phase 0 — Foundations.** Not yet scaffolded.

V1 covers Gates 0–6 and 8: security capture, T1 receiving with a configurable inspection engine, GRN, put-away to zone, department issue with card scan, and the reconciliation alert. Gates 7, 9 and 10 and the returnable register are V2.
