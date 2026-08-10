# 0007 — QR codes carry an identifier only, never data or credentials

**Status:** Accepted
**Date:** 2026-08-10

## Context

Two card schemes exist: party cards for vendors and other counterparties (§4 Gate 0b) and staff cards for anyone who receives material (§5). It is tempting to encode useful payload in the QR — licence validity, tier, department, contact details — so a scan works with no lookup at all.

Everything on that list goes stale. A vendor's FSSAI licence expires, their tier changes, they get placed on hold, an employee changes department or leaves. Encoded payload would mean reissuing physical cards to change a status.

There is also a security question: cards are copied, photographed and shared. A borrowed staff card is the obvious attack on the scan-to-receive control.

## Decision

**The QR encodes the entity ID and nothing else.** Party code, or person code, with a check digit. Everything else — tier, hold status, licence validity, outstanding returnables, department, photograph — resolves at scan time, from the server or from the device's cache.

The card is an **identifier, not a credential**. It authorises nothing. Scanning identifies a party; every check and approval still runs normally.

## Consequences

- A vendor's status can change without reissuing a single card. Revocation is server-side status, never card recall.
- A blacklisted vendor's card scans successfully and displays as blocked. That is the desired behaviour, not a bug — the guard needs to see _who_ is at the gate before being told they may not unload.
- There is no PII on a card and therefore no meaningful risk in a copied one, which matters under the DPDP Act.
- Because a copied card still identifies correctly, the borrowed-card attack is defeated elsewhere: **the receiver's photograph displays on scan from cache** and the storekeeper confirms it (§5, criterion 18). That photo cache is therefore load-bearing, not a nicety.
- The check digit means a manually typed code cannot be silently wrong. Manual entry is permitted for party codes and **not** for person codes — a forgotten staff card goes through supervisor override with a reason code, so accountability moves rather than disappearing.
- Never add payload to a QR "just to save a lookup". The lookup is the feature.
