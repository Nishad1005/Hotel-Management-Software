import { Ionicons } from "@expo/vector-icons";
import type { ScanMethod } from "@golai/db";
import { isPersonCode } from "@golai/domain";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Image, Pressable, StyleSheet, View, type ViewStyle } from "react-native";
import {
  Banner,
  Card,
  Field,
  FieldError,
  Notice,
  PrimaryButton,
  Result,
  Screen,
  SelectRow,
  SkeletonList,
  StatusPill,
  Text,
} from "../../components/ui";
import {
  issueStock,
  listDepartments,
  listIssuableStock,
  type Department,
  type DraftIssueLine,
  type IssuableLot,
  type IssuedResult,
} from "../../lib/issuing";
import { ScanField } from "../../components/scan-field";
import { photoUrl } from "../../lib/evidence";
import { listPeople, type Person } from "../../lib/people";
import { useSession } from "../../lib/session";
import { newSubmissionId } from "../../lib/stock";
import { radius, space, usePalette } from "../../theme";

/**
 * Gate 8 — issuing to a department.
 *
 * The list is first-expired-first-out and the oldest lot sits at the top, because the
 * decision this screen exists to influence is which batch goes out, not whether flour
 * goes out. A storekeeper choosing by what is nearest to the door is how a store ends up
 * writing off the back of a shelf every month.
 *
 * ## The scan, and the gap that remains
 *
 * The receiver presents a card and the storekeeper scans it here. That scan is the
 * acknowledgement (PRD section 4 Gate 8): it identifies a person at a timestamp against
 * a specific batch from a specific bin, which a typed name never could.
 *
 * Two honest gaps remain and are said on screen rather than implied away. There is no
 * photograph yet — criterion 18 needs an image store — so the storekeeper cannot check
 * the face against the card, and a borrowed card still works. And an issue with no card
 * is still allowed, because no cards are printed: it records as unverified and carries a
 * supervisor's reason. Blocking it while the property has no cards would produce
 * click-through, and a click-through record asserts something false rather than leaving
 * a visible hole (PRD section 2).
 */
/**
 * What a scanned code means here.
 *
 * Resolved against the cached staff master rather than by asking the server, because the
 * dock is where the network is worst and a scan that needs a round trip is a scan that
 * fails in the cold room. The check digit is checked first: a misread that lands on
 * another real person's number is the failure worth engineering against, and refusing a
 * malformed code before any lookup is what stops it.
 *
 * A stopped card is told apart from an unknown one deliberately. "No such card" reads as
 * damage and invites a retry; "this card was stopped" ends the conversation at the
 * counter. The server checks again regardless — this cache can be hours old, and
 * criterion 19 is a claim about the server.
 */
function resolveCard(code: string, people: Person[]): { person: Person | null; why: string } {
  if (!isPersonCode(code)) {
    return { person: null, why: "That is not a staff card from this property." };
  }
  const match = people.find((x) => x.personCode.toUpperCase() === code.trim().toUpperCase());
  if (!match) {
    return { person: null, why: "That card is not on this property's staff master." };
  }
  if (!match.isActive) {
    return { person: null, why: `${match.fullName}'s card was stopped. It cannot take custody.` };
  }
  return { person: match, why: "" };
}

export default function IssueStock() {
  const p = usePalette();
  const router = useRouter();
  const { activeProperty } = useSession();

  const [lots, setLots] = useState<IssuableLot[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [lines, setLines] = useState<DraftIssueLine[]>([]);
  const [departmentId, setDepartmentId] = useState("");
  const [receiver, setReceiver] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [card, setCard] = useState<{ person: Person; method: ScanMethod } | null>(null);
  const [cardError, setCardError] = useState<string | null>(null);
  const [staffError, setStaffError] = useState<string | null>(null);
  const [faceUrl, setFaceUrl] = useState<string | null>(null);

  /*
    The face is fetched when a card resolves, not with the master.

    Signing a URL per person up front would mint dozens that expire unused; the scan is
    the moment one is needed, and it is one round trip on a screen that has just done a
    lookup with none.
  */
  useEffect(() => {
    let alive = true;
    const ref = card?.person.photoRef ?? null;
    if (!ref) {
      setFaceUrl(null);
      return;
    }
    void photoUrl(ref).then((u) => {
      if (alive) setFaceUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [card]);
  const [overriding, setOverriding] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [purpose, setPurpose] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedResult | null>(null);

  const propertyId = activeProperty?.propertyId ?? null;

  const refresh = useCallback(async () => {
    if (!propertyId) return;
    try {
      const [stock, depts] = await Promise.all([listIssuableStock(propertyId), listDepartments()]);
      setLots(stock);
      setDepartments(depts);

      /*
        The staff master is fetched separately, and its failure is survivable.

        It was in the Promise.all above for one build, and that was wrong in a way worth
        recording: when the staff master could not be read the whole screen showed "could
        not load the store" and no stock could be issued at all. The dock cannot stop
        because a supplementary list is unavailable — losing it costs the scan, not the
        shift, and the override path is exactly the road that stays open.

        PRD section 4 Gate 8 wants this cached on the device so a card resolves with no
        network; this is the fetch that fills that cache.
      */
      try {
        setPeople(await listPeople(propertyId));
        setStaffError(null);
      } catch (e) {
        setPeople([]);
        setStaffError(e instanceof Error ? e.message : String(e));
      }
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void refresh();
    }, [refresh]),
  );

  const taken = useMemo(() => {
    const by = new Map<string, number>();
    for (const l of lines) by.set(key(l.lot), (by.get(key(l.lot)) ?? 0) + l.qty);
    return by;
  }, [lines]);

  const problems: string[] = [];
  if (lines.length === 0) problems.push("Add at least one line.");
  if (!departmentId) problems.push("Choose who it is going to.");
  /*
    A card, or an override that says why there was none.

    Not "a name", which is what this asked for before. A typed name is what the override
    path records alongside the supervisor's reason; on its own it is an assertion nobody
    can check, and asking for it as though it were sufficient is what made criterion 17
    look satisfied when it was not.
  */
  if (!card && !overriding) problems.push("Scan the receiver's card.");
  if (overriding && !receiver.trim()) problems.push("Say who is taking it.");
  if (overriding && !overrideReason.trim())
    problems.push("Say why they have no card. The override carries your name.");

  async function send() {
    if (!propertyId || problems.length > 0) return;
    setSending(true);
    setError(null);
    try {
      const result = await issueStock({
        propertyId,
        departmentId,
        receiverName: card ? card.person.fullName : receiver.trim(),
        purpose: purpose.trim() || null,
        lines,
        submissionId: newSubmissionId(),
        receiverPersonId: card ? card.person.id : null,
        scanMethod: card ? card.method : null,
        overrideReason: overriding ? overrideReason.trim() : null,
      });
      setIssued(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  if (issued) {
    return (
      <IssuedPanel
        result={issued}
        department={departments.find((d) => d.id === departmentId)?.name ?? "the department"}
        receiver={card ? card.person.fullName : receiver.trim()}
        scanned={Boolean(card)}
        hadFace={Boolean(card && card.person.photoRef)}
        lineCount={lines.length}
        onAgain={() => {
          setIssued(null);
          setLines([]);
          setReceiver("");
          setPurpose("");
          void refresh();
        }}
        onDone={() => router.replace("/")}
      />
    );
  }

  return (
    <Screen
      onSubmit={() => void send()}
      title="Issue stock"
      subtitle="Gate 8 — out of the store, into a department"
      onBack={() => router.back()}
      {...(lines.length > 0
        ? {
            footer: (
              <>
                <Text role="caption" tone="muted" style={{ marginBottom: space.sm }}>
                  {problems.length > 0
                    ? problems[0]
                    : `${lines.length} line${lines.length === 1 ? "" : "s"} to ${receiver.trim()}`}
                </Text>
                <PrimaryButton
                  label="Issue"
                  icon="arrow-forward"
                  density="field"
                  onPress={() => void send()}
                  loading={sending}
                  disabled={problems.length > 0}
                />
              </>
            ),
          }
        : {})}
    >
      {loading ? (
        <SkeletonList />
      ) : loadError ? (
        <Notice
          icon="cloud-offline-outline"
          title="Could not load the store"
          body={loadError}
          tone="bad"
        />
      ) : lots.length === 0 ? (
        <Notice
          icon="file-tray-outline"
          title="Nothing is issuable yet"
          body="Only stock that has been put away into a bin can be issued. Receive a delivery, put it away, and it appears here."
          action={<PrimaryButton label="Go to put away" onPress={() => router.push("/putaway")} />}
        />
      ) : (
        <>
          {lines.length > 0 ? (
            <View style={{ marginBottom: space.xl }}>
              <Label>Going out</Label>
              <Card padded={false}>
                {lines.map((l, i) => (
                  <DraftRow
                    key={`${key(l.lot)}-${i}`}
                    line={l}
                    divider={i < lines.length - 1}
                    onRemove={() => setLines((prev) => prev.filter((_, j) => j !== i))}
                  />
                ))}
              </Card>
            </View>
          ) : null}

          <Card>
            <SelectRow
              label="Department"
              value={departmentId || null}
              placeholder="Who is it going to?"
              choices={departments.map((d) => ({ id: d.id, label: d.name, sublabel: d.code }))}
              onSelect={setDepartmentId}
            />

            {/*
              The scan, or the override. Never both, and never neither without saying so.

              The storekeeper holds the device and scans the card the receiver presents —
              the receiver does not operate the app (PRD section 4 Gate 8). One device,
              one scan.
            */}
            {card ? (
              <View style={{ marginBottom: space.lg }}>
                <Text role="label" weight="semibold" style={{ marginBottom: space.xs }}>
                  Received by
                </Text>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: p.border,
                    borderRadius: radius.md,
                    backgroundColor: p.successSurface,
                    padding: space.md,
                  }}
                >
                  {/*
                    The face, criterion 18. It is the control: a borrowed card scans
                    perfectly, and the only thing that catches it is the storekeeper
                    looking at the photograph and then at the person.
                  */}
                  {faceUrl ? (
                    <Image
                      source={{ uri: faceUrl }}
                      style={{ width: 48, height: 48, borderRadius: radius.sm }}
                      resizeMode="cover"
                      accessibilityLabel={`Photograph of ${card.person.fullName}`}
                    />
                  ) : (
                    <Ionicons name="checkmark-circle" size={20} color={p.success} />
                  )}
                  <View style={{ flex: 1, marginLeft: space.sm }}>
                    <Text weight="semibold">{card.person.fullName}</Text>
                    <Text role="caption" tone="muted">
                      {card.person.personCode}
                      {card.person.departmentName ? ` · ${card.person.departmentName}` : ""}
                    </Text>
                  </View>
                  <PrimaryButton
                    label="Not them"
                    tone="neutral"
                    onPress={() => {
                      setCard(null);
                      setCardError(null);
                    }}
                  />
                </View>
                {/*
                  The control this build does not have, said where it is missing rather
                  than in a release note. A borrowed card scans perfectly.
                */}
                {/*
                  Said only when it is true. A storekeeper who is told the check is
                  missing will look harder; one who is told it every time, including when
                  a face is on screen, stops reading the sentence.
                */}
                {faceUrl ? null : (
                  <Text role="caption" tone="muted" style={{ marginTop: space.xs }}>
                    No photograph on file, so the card is not checked against the face.
                  </Text>
                )}
              </View>
            ) : overriding ? (
              <>
                <Field
                  label="Received by"
                  value={receiver}
                  onChangeText={setReceiver}
                  placeholder="The name of the person taking it"
                  autoCapitalize="words"
                  density="field"
                />
                <Field
                  label="Why they have no card"
                  value={overrideReason}
                  onChangeText={setOverrideReason}
                  placeholder="Left it at home, new starter, card lost"
                  autoCapitalize="sentences"
                  hint="This is recorded against your name, not theirs. Repeated overrides are what the exception report is for."
                  density="field"
                />
                <View style={{ marginBottom: space.lg }}>
                  <PrimaryButton
                    label="They do have a card"
                    icon="qr-code-outline"
                    tone="neutral"
                    onPress={() => {
                      setOverriding(false);
                      setOverrideReason("");
                    }}
                  />
                </View>
              </>
            ) : (
              <View style={{ marginBottom: space.lg }}>
                {/*
                  When the master is unreachable there is nothing to scan against, and
                  saying so is better than a field that rejects every card it is given.
                */}
                {staffError ? (
                  <Banner icon="cloud-offline" tone="warn">
                    The staff master could not be read, so a card cannot be checked. Record who
                    collected it and why there was no scan.
                  </Banner>
                ) : null}
                <ScanField
                  label="Scan the receiver's card"
                  placeholder="Their card number"
                  hint="The receiver presents the card; you scan it. Typing is counted."
                  autoFocus={false}
                  onScan={(code, method) => {
                    const found = resolveCard(code, people);
                    if (found.person) {
                      setCard({ person: found.person, method });
                      setCardError(null);
                    } else {
                      setCard(null);
                      setCardError(found.why);
                    }
                  }}
                />
                {cardError ? <FieldError message={cardError} /> : null}
                <PrimaryButton
                  label="No card"
                  icon="help-circle-outline"
                  tone="neutral"
                  onPress={() => {
                    setOverriding(true);
                    setCardError(null);
                  }}
                />
              </View>
            )}

            <Field
              label="What for"
              value={purpose}
              onChangeText={setPurpose}
              placeholder="Optional — breakfast prep, banquet, a room"
              autoCapitalize="sentences"
            />
          </Card>

          <View style={{ height: space.xl }} />

          <Label>Pick from the store — oldest first</Label>
          <Card padded={false}>
            {lots.map((lot, i) => (
              <LotRow
                key={key(lot)}
                lot={lot}
                alreadyTaken={taken.get(key(lot)) ?? 0}
                divider={i < lots.length - 1}
                onAdd={(qty) => {
                  setLines((prev) => [...prev, { lot, qty }]);
                  setError(null);
                }}
              />
            ))}
          </Card>

          {error ? (
            <View style={{ marginTop: space.lg }}>
              <FieldError message={error} />
            </View>
          ) : null}
        </>
      )}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// The store, oldest first
// ---------------------------------------------------------------------------

function LotRow({
  lot,
  alreadyTaken,
  divider,
  onAdd,
}: {
  lot: IssuableLot;
  alreadyTaken: number;
  divider: boolean;
  onAdd: (qty: number) => void;
}) {
  const p = usePalette();
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState("");

  const left = lot.qty - alreadyTaken;
  const amount = Number(qty);
  const valid = qty.trim().length > 0 && Number.isFinite(amount) && amount > 0 && amount <= left;

  const days = lot.daysRemaining;
  const expiry =
    days === null
      ? null
      : days < 0
        ? { label: `Expired ${Math.abs(days)} d ago`, tone: "bad" as const }
        : days <= 2
          ? { label: `${days} d left`, tone: "bad" as const }
          : days <= 7
            ? { label: `${days} d left`, tone: "warn" as const }
            : { label: `${days} d left`, tone: "neutral" as const };

  return (
    <View
      style={{
        borderBottomWidth: divider ? StyleSheet.hairlineWidth : 0,
        borderBottomColor: p.border,
        // Taken-out rows recede through their own tones, not a 0.45 veil that took the
        // item name to 2.87:1.
        backgroundColor: left <= 0 ? p.surfaceSunken : "transparent",
      }}
    >
      <Pressable
        onPress={() => left > 0 && setOpen((v) => !v)}
        disabled={left <= 0}
        accessibilityRole="button"
        accessibilityState={{ expanded: open, disabled: left <= 0 }}
        accessibilityLabel={`${lot.itemName}, batch ${lot.batchNo}, ${left} ${lot.uomCode} at ${lot.locationCode}`}
        style={({ pressed, hovered }) =>
          ({
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: space.lg,
            paddingVertical: space.md,
            minHeight: 68,
            backgroundColor: pressed ? p.border : hovered ? p.surfaceSunken : "transparent",
            cursor: left > 0 ? "pointer" : "not-allowed",
          }) as ViewStyle
        }
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text weight="semibold" lines={1}>
            {lot.itemName}
          </Text>
          <Text role="caption" tone="muted" lines={1} style={{ marginTop: 1 }}>
            {lot.batchNo} · {lot.locationCode}
          </Text>
          {expiry ? (
            <View style={{ marginTop: space.xs }}>
              <StatusPill
                icon={expiry.tone === "bad" ? "alert-circle" : "hourglass-outline"}
                label={expiry.label}
                tone={expiry.tone}
              />
            </View>
          ) : null}
        </View>

        <Text role="heading" numeric style={{ marginRight: space.sm }}>
          {left}
          <Text role="caption" tone="muted" weight="medium">
            {" "}
            {lot.uomCode}
          </Text>
        </Text>
        <Ionicons name={open ? "chevron-up" : "add"} size={18} color={p.accent} />
      </Pressable>

      {open ? (
        <View style={{ paddingHorizontal: space.lg, paddingBottom: space.md }}>
          {/*
            Expired stock is offered rather than hidden. The rule ships RECORD_ONLY, and a
            kitchen that cannot issue at seven in the morning works around the system
            rather than around the expiry. What the system insists on is that the fact
            survives on the issue line.
          */}
          {days !== null && days < 0 ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                backgroundColor: p.dangerSurface,
                borderRadius: radius.sm,
                padding: space.sm,
                marginBottom: space.md,
              }}
            >
              <Ionicons name="alert-circle" size={15} color={p.danger} style={{ marginTop: 1 }} />
              <Text role="caption" tone="danger" style={{ flex: 1, marginLeft: space.xs }}>
                This batch is past its date. It can still be issued, and the issue will permanently
                record that it was expired and by how many days.
              </Text>
            </View>
          ) : null}

          <Field
            label="How much"
            value={qty}
            onChangeText={setQty}
            placeholder="0"
            keyboardType="decimal-pad"
            suffix={lot.uomCode}
            hint={`Up to ${left} ${lot.uomCode} in ${lot.locationName}.`}
          />
          <PrimaryButton
            label="Add"
            icon="add"
            tone="neutral"
            onPress={() => {
              if (!valid) return;
              onAdd(amount);
              setQty("");
              setOpen(false);
            }}
            disabled={!valid}
          />
        </View>
      ) : null}
    </View>
  );
}

function DraftRow({
  line,
  divider,
  onRemove,
}: {
  line: DraftIssueLine;
  divider: boolean;
  onRemove: () => void;
}) {
  const p = usePalette();
  const expired = (line.lot.daysRemaining ?? 0) < 0;

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        borderBottomWidth: divider ? StyleSheet.hairlineWidth : 0,
        borderBottomColor: p.border,
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text weight="semibold" lines={1}>
          {line.qty} {line.lot.uomCode} · {line.lot.itemName}
        </Text>
        <Text role="caption" tone="muted" lines={1} style={{ marginTop: 1 }}>
          {line.lot.batchNo} from {line.lot.locationCode}
        </Text>
        {expired ? (
          <View style={{ marginTop: space.xs }}>
            <StatusPill icon="alert-circle" label="Expired — recorded on the issue" tone="bad" />
          </View>
        ) : null}
      </View>
      <Pressable
        onPress={onRemove}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${line.lot.itemName} from this issue`}
        hitSlop={10}
        style={({ pressed, hovered }) => ({
          width: 40,
          height: 40,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: radius.sm,
          backgroundColor: pressed || hovered ? p.dangerSurface : "transparent",
          cursor: "pointer",
        })}
      >
        <Ionicons name="close" size={18} color={p.textMuted} />
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// After issuing
// ---------------------------------------------------------------------------

function IssuedPanel({
  result,
  department,
  receiver,
  scanned,
  hadFace,
  lineCount,
  onAgain,
  onDone,
}: {
  result: IssuedResult;
  department: string;
  receiver: string;
  /** Whether a card was scanned, as opposed to a name being typed under an override. */
  scanned: boolean;
  /** Whether that card carried a photograph, which is a different claim again. */
  hadFace: boolean;
  lineCount: number;
  onAgain: () => void;
  onDone: () => void;
}) {
  /*
    A queued issue promises less than a queued receipt, and says so.

    A receipt is an append: it will land. An issue takes stock, and by the time the
    queue drains another storekeeper may have taken the same lot during the same
    outage — the server will refuse it, and that refusal is the system working. So the
    wording here stops at "recorded", and does not claim the stock has moved.
  */
  const queued = result.status === "QUEUED";

  return (
    <Result
      eyebrow={queued ? "Recorded on this device" : "Issued"}
      value={queued ? "Waiting for a signal" : result.issueNo}
      caption={`${lineCount} line${lineCount === 1 ? "" : "s"} to ${department}, collected by ${receiver}`}
      actions={
        <>
          <PrimaryButton
            label="Issue something else"
            icon="add"
            density="field"
            onPress={onAgain}
          />
          <View style={{ height: space.md }} />
          <PrimaryButton label="Done" tone="neutral" onPress={onDone} />
        </>
      }
    >
      {queued ? (
        <Banner icon="cloud-offline" tone="warn">
          This is on the device, not yet on the books. It goes out when the network returns. If
          somebody else took the same batch while both of you were offline, the store will say so
          then rather than let the ledger go negative.
        </Banner>
      ) : null}

      {!queued && result.expiredLines > 0 ? (
        <Banner icon="alert-circle" tone="warn">
          {result.expiredLines} line{result.expiredLines === 1 ? " was" : "s were"} past date.
          Recorded on the issue with the days elapsed.
        </Banner>
      ) : null}

      {/*
        Stated on the success screen, not only in a hint on the form. This is the claim the
        property will repeat to an auditor, and it has to be the accurate one — which means
        it has to change when what happened changes.

        It said "the receiver's name was typed, not scanned from a card" on every issue,
        including scanned ones, for as long as scanning has existed. A panel that describes
        the weaker control while the stronger one was used is worse than no panel: it is
        the record asserting something false about itself, which is the failure this whole
        screen is built to avoid.
      */}
      <Text role="caption" tone="muted">
        {!scanned
          ? "The receiver's name was typed under a supervisor's override, not scanned from a card, so this records who the storekeeper says collected it."
          : hadFace
            ? "Identified by their card, and their photograph was on screen when it was scanned."
            : "Identified by their card. There is no photograph on file for them, so the card was not checked against the face."}
      </Text>
    </Result>
  );
}

function Label({ children }: { children: string }) {
  return (
    <Text
      accessibilityRole="header"
      role="overline"
      tone="muted"
      style={{ marginBottom: space.sm }}
    >
      {children}
    </Text>
  );
}

/** A lot is a batch in a place. The same batch in two bins is two things to pick from. */
function key(lot: IssuableLot): string {
  return `${lot.batchId}:${lot.locationId}`;
}
