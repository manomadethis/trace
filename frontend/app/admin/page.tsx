"use client";

/**
 * `/admin` — the pitch-hero live cascade view.
 *
 * On mount, loads the batch board (`batchesStore`) and opens the live event
 * stream (`sseStore`), which auto-plays the mock cascade once (batches
 * 1001/1002 walking GRADED_FARM -> ... -> PAID over ~20s, one hitting a
 * decay/reroute-to-secondary-market anomaly, the other a route-disruption
 * anomaly). The "Run demo" / "Simulate route disruption" buttons reset and
 * replay either cascade on demand via `runCascade()`, for a presenter who
 * wants to trigger an anomaly again without reloading the page.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, type CardWobble } from "@/components/handdrawn/Card";
import { Badge, type BadgeGrade } from "@/components/handdrawn/Badge";
import { Button } from "@/components/handdrawn/Button";
import { useBatchesStore } from "@/stores/batchesStore";
import { useSseStore, type ConnectionStatus } from "@/stores/sseStore";
import { runCascade, type Batch } from "@/lib/api";
import type { StreamMessage } from "@/lib/sse";

const WOBBLES: CardWobble[] = [1, 2, "none", 3];

function wobbleFor(index: number): CardWobble {
  return WOBBLES[index % WOBBLES.length];
}

function gradeToBadgeGrade(grade: Batch["farmGrade"]): BadgeGrade {
  if (grade === "A") return "A";
  if (grade === "B") return "B";
  return "Waste";
}

/** Statuses whose batches are heading outbound to the premium buyer. */
const OUTBOUND_STATUSES = new Set<Batch["status"]>([
  "HARVESTED",
  "GRADED_FARM",
  "POOLED",
  "CONTRACTED",
  "SHIPPED",
  "GRADED_HANDOFF",
  "DELIVERED",
]);

/** Statuses that mean the batch is on the returning leg (secondary/composter/waste). */
const RETURNING_STATUSES = new Set<Batch["status"]>([
  "REROUTED",
  "DELIVERED_SECONDARY",
  "COMPOSTED",
  "DISPUTED",
  "LOST",
]);

function statusLabel(status: Batch["status"]): string {
  switch (status) {
    case "DELIVERED":
      return "Delivered (premium)";
    case "DELIVERED_SECONDARY":
      return "Delivered (secondary)";
    case "REROUTED":
      return "Rerouted";
    case "COMPOSTED":
      return "Composted";
    case "PAID":
      return "Paid";
    case "DISPUTED":
      return "Disputed";
    case "LOST":
      return "Lost";
    default:
      return status.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  }
}

function connectionLabel(status: ConnectionStatus): string {
  switch (status) {
    case "open":
      return "Live";
    case "connecting":
      return "Connecting…";
    case "error":
      return "Disconnected";
    case "closed":
      return "Closed";
    default:
      return "Idle";
  }
}

function connectionDotClass(status: ConnectionStatus): string {
  switch (status) {
    case "open":
      return "bg-green-500 animate-pulse";
    case "connecting":
      return "bg-yellow-500 animate-pulse";
    case "error":
      return "bg-accent";
    default:
      return "bg-gray-400";
  }
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export default function AdminPage() {
  const { batches, loading, error, fetchBatches } = useBatchesStore();
  const { status, events, connect } = useSseStore();
  const [runningDemo, setRunningDemo] = useState<"decay" | "disruption" | null>(null);

  useEffect(() => {
    fetchBatches();
    connect();
    // Mount-only: fetchBatches/connect are stable store actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRunCascade = async (kind: "decay" | "disruption") => {
    if (runningDemo) return;
    setRunningDemo(kind);
    try {
      await runCascade(kind);
      await fetchBatches();
    } finally {
      setRunningDemo(null);
    }
  };

  const outbound = batches.filter((b) => OUTBOUND_STATUSES.has(b.status));
  const returning = batches.filter((b) => RETURNING_STATUSES.has(b.status));
  const paid = batches.filter((b) => b.status === "PAID");

  return (
    <div className="mx-auto min-h-screen w-full max-w-[1280px] px-4 py-8 md:px-8">
      <AdminHeader status={status} runningDemo={runningDemo} onRunCascade={handleRunCascade} />

      {error && (
        <div className="mb-6 rounded-card border-2 border-accent bg-accent/10 p-4 font-bold text-accent">
          Failed to load batches: {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_360px]">
        {/* Left: dual-purpose fleet board */}
        <div className="flex flex-col gap-10">
          <FleetSection
            title="Outbound — premium buyer"
            subtitle="Farm-graded produce heading to contracted premium buyers."
            icon="local_shipping"
            accentClass="border-primary"
            batches={outbound}
            emptyLabel="No batches outbound right now."
          />
          <FleetSection
            title="Returning — secondary / composter / waste"
            subtitle="Rerouted, delivered-secondary, composted, or disputed batches on the return leg."
            icon="recycling"
            accentClass="border-accent"
            batches={returning}
            emptyLabel="Nothing on the returning leg yet."
          />
          {paid.length > 0 && (
            <FleetSection
              title="Paid out"
              subtitle="Cascade complete — payout released."
              icon="paid"
              accentClass="border-success"
              batches={paid}
              emptyLabel=""
            />
          )}
          {!loading && batches.length === 0 && !error && (
            <p className="text-lg text-gray-500">No batches loaded yet.</p>
          )}
        </div>

        {/* Right: provenance/audit timeline */}
        <ProvenanceTimeline events={events} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function AdminHeader({
  status,
  runningDemo,
  onRunCascade,
}: {
  status: ConnectionStatus;
  runningDemo: "decay" | "disruption" | null;
  onRunCascade: (kind: "decay" | "disruption") => void;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-4">
        <Link href="/" className="-rotate-2 inline-flex items-center justify-center rounded-full border-2 border-primary bg-white px-4 py-1 shadow-hard">
          <span className="text-2xl font-bold tracking-tight">TRACE</span>
        </Link>
        <div>
          <h1 className="text-3xl font-bold">Admin — Live Cascade</h1>
          <p className="text-gray-600">Real-time batch lifecycle, dual-purpose fleet, and provenance.</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="primary"
          disabled={runningDemo !== null}
          onClick={() => onRunCascade("decay")}
          className="flex items-center gap-2"
        >
          <span className="material-symbols-outlined text-lg">play_arrow</span>
          {runningDemo === "decay" ? "Running…" : "Run demo"}
        </Button>
        <Button
          type="button"
          variant="accent"
          disabled={runningDemo !== null}
          onClick={() => onRunCascade("disruption")}
          className="flex items-center gap-2"
        >
          <span className="material-symbols-outlined text-lg">alt_route</span>
          {runningDemo === "disruption" ? "Simulating…" : "Simulate route disruption"}
        </Button>
        <div className="flex items-center gap-2 rounded-full border-2 border-primary bg-white px-4 py-2 shadow-hard">
          <span className={`h-3 w-3 rounded-full border border-primary ${connectionDotClass(status)}`} />
          <span className="font-bold">{connectionLabel(status)}</span>
        </div>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Fleet section (dual-purpose grouping)
// ---------------------------------------------------------------------------

function FleetSection({
  title,
  subtitle,
  icon,
  accentClass,
  batches,
  emptyLabel,
}: {
  title: string;
  subtitle: string;
  icon: string;
  accentClass: string;
  batches: Batch[];
  emptyLabel: string;
}) {
  return (
    <section>
      <div className={`mb-4 flex items-center gap-3 border-b-2 pb-2 ${accentClass}`}>
        <span className="material-symbols-outlined text-2xl">{icon}</span>
        <div>
          <h2 className="text-xl font-bold">{title}</h2>
          <p className="text-sm text-gray-500">{subtitle}</p>
        </div>
        <span className="ml-auto rounded-full border-2 border-primary bg-white px-3 py-1 text-sm font-bold shadow-hard">
          {batches.length}
        </span>
      </div>
      {batches.length === 0 ? (
        <p className="text-gray-400">{emptyLabel}</p>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {batches.map((batch, i) => (
            <BatchCard key={batch.id} batch={batch} wobble={wobbleFor(i)} />
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Batch card
// ---------------------------------------------------------------------------

function BatchCard({ batch, wobble }: { batch: Batch; wobble: CardWobble }) {
  const decayed =
    !!batch.farmGrade && !!batch.handoffGrade && batch.farmGrade !== batch.handoffGrade;
  const rerouted = batch.status === "REROUTED" || !!batch.marketCategory;
  const reasonEntry = [...(batch.timeline ?? [])].reverse().find((t) =>
    /reroute|disrupt|decay/i.test(t.label)
  );

  return (
    <Card wobble={wobble} className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold">
          #{batch.batchNumber} · {batch.crop}
        </h3>
        <span className="rounded-full bg-primary/5 px-3 py-1 text-xs font-bold uppercase tracking-wide">
          {statusLabel(batch.status)}
        </span>
      </div>

      <p className="text-sm text-gray-500">{batch.kg}kg</p>

      <div
        className={`flex items-center justify-between gap-2 rounded-card border-2 border-dashed p-3 ${
          decayed ? "border-accent bg-accent/10" : "border-gray-300"
        }`}
      >
        <div className="text-center">
          <p className="text-xs uppercase text-gray-500">Farm</p>
          {batch.farmGrade ? (
            <Badge grade={gradeToBadgeGrade(batch.farmGrade)} />
          ) : (
            <span className="text-sm text-gray-400">—</span>
          )}
        </div>
        <span className="material-symbols-outlined text-gray-400">arrow_forward</span>
        <div className="text-center">
          <p className="text-xs uppercase text-gray-500">Handoff</p>
          {batch.handoffGrade ? (
            <Badge grade={gradeToBadgeGrade(batch.handoffGrade)} />
          ) : (
            <span className="text-sm text-gray-400">Pending</span>
          )}
        </div>
      </div>

      {decayed && (
        <p className="text-sm font-bold text-accent">
          Decay detected: Grade {batch.farmGrade} → {batch.handoffGrade}
        </p>
      )}

      {rerouted && reasonEntry && (
        <p className="flex items-center gap-1 text-sm text-accent">
          <span className="material-symbols-outlined text-base">alt_route</span>
          {reasonEntry.label}
        </p>
      )}

      {batch.marketCategory && (
        <p className="text-sm text-gray-600">
          Market:{" "}
          <span className="font-bold">
            {batch.marketCategory.replaceAll("_", " ")}
          </span>
        </p>
      )}

      {batch.status === "PAID" && (
        <p className="flex items-center gap-1 text-sm font-bold text-success">
          <span className="material-symbols-outlined text-base">paid</span>
          Payout released
        </p>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Provenance timeline
// ---------------------------------------------------------------------------

function ProvenanceTimeline({ events }: { events: StreamMessage[] }) {
  const ordered = [...events].reverse();

  return (
    <aside className="h-fit lg:sticky lg:top-8">
      <Card wobble="none" className="max-h-[80vh] overflow-hidden">
        <h2 className="mb-4 flex items-center gap-2 text-xl font-bold">
          <span className="material-symbols-outlined text-xl">history</span>
          Provenance Timeline
        </h2>
        <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
          {ordered.length === 0 && (
            <p className="text-gray-400">Waiting for events…</p>
          )}
          {ordered.map((evt, i) => (
            <TimelineRow key={i} event={evt} />
          ))}
        </div>
      </Card>
    </aside>
  );
}

function TimelineRow({ event }: { event: StreamMessage }) {
  const payload = event.payload ?? {};
  const batchId = (payload.batchId ?? payload.batch_id) as string | undefined;
  const eventType = (payload.eventType ?? payload.event_type ?? event.event) as string;
  const createdAt = (payload.createdAt as string | undefined) ?? undefined;

  const description = describeEvent(event.event, eventType, payload);

  return (
    <div className="border-l-2 border-dashed border-primary/20 pl-3">
      <p className="text-xs text-gray-400">
        {createdAt ? formatTime(createdAt) : ""}
        {batchId ? ` · Batch #${batchId}` : ""}
      </p>
      <p className="text-sm font-bold">{eventType}</p>
      {description && <p className="text-sm text-gray-600">{description}</p>}
    </div>
  );
}

function describeEvent(
  event: string,
  eventType: string,
  payload: Record<string, unknown>
): string | null {
  if (event === "payout") {
    return `Payout of $${payload.amount ?? "?"} released.`;
  }
  if (event === "anomaly") {
    return `Anomaly: ${payload.kind ?? "unknown"}.`;
  }
  if (eventType.startsWith("transition:")) {
    const from = payload.from as string | undefined;
    const to = payload.to as string | undefined;
    const extra =
      (payload.reason_code as string | undefined) ??
      (payload.decay_event as string | undefined) ??
      (payload.market_category as string | undefined);
    return `${from ?? "?"} → ${to ?? "?"}${extra ? ` (${extra})` : ""}`;
  }
  return null;
}
