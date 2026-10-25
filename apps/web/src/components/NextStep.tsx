import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { NextStepCard } from "@cuntas/engine";
import { newId } from "@cuntas/ledger";
import { isCurrency } from "@cuntas/rules";
import { money, formatDate } from "../lib/format";
import { update } from "../lib/store";
import { Badge, Button, Card, Field, Input, Modal, ProgressBar, Why } from "./ui";

function progressText(card: NextStepCard) {
  const { current, target, unit } = card.progress;
  if (isCurrency(unit)) return target === 0 ? `${money(current, unit)} to clear` : `${money(current, unit)} of ${money(target, unit)}`;
  if (unit === "%") return `${current}% of ${target}%`;
  if (unit === "months") return `${current} of ${target} months`;
  return `${current} of ${target}`;
}

export function NextStep({ card, secondary }: { card: NextStepCard; secondary?: boolean }) {
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState("");
  const { current, target } = card.progress;
  const clearing = target === 0;
  return (
    <Card className={secondary ? "border-amber-200 dark:border-amber-900" : "border-brand-200 ring-1 ring-brand-100 dark:border-brand-900 dark:ring-brand-900"}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge tone={secondary ? "warn" : "good"}>{secondary ? "Always on · step " : "Your next step · step "}{card.order}</Badge>
        {card.jurisdictions.map((j) => (
          <Badge key={j}>{j}</Badge>
        ))}
        {card.memberName && <Badge tone="info">{card.memberName}</Badge>}
      </div>
      <h3 className="text-lg font-semibold leading-snug">{card.headline}</h3>
      <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">{card.why}</p>
      <div className="mt-4 space-y-1">
        <ProgressBar value={clearing ? 0 : current} max={clearing ? 1 : target} tone={secondary ? "warn" : "brand"} />
        <div className="flex justify-between text-xs text-stone-500">
          <span>{progressText(card)}</span>
          {card.deadline && <span>Deadline {formatDate(card.deadline)}</span>}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {card.actions.map((a) => (
          <Link key={a.id} to={a.to} className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">{a.label}</Link>
        ))}
        <Button variant="ghost" onClick={() => setDismissing(true)}>Not relevant to me</Button>
      </div>
      <div className="mt-3">
        <Why sources={card.sources}>
          <p className="text-stone-600 dark:text-stone-400">
            Rule pack <code>{card.rulePack}</code>, chart defaults <code>{card.chart}</code>, check <code>{card.check}</code>.
          </p>
        </Why>
      </div>
      <Modal open={dismissing} onClose={() => setDismissing(false)} title="Not relevant to me">
        <p className="mb-3 text-sm text-stone-600 dark:text-stone-400">Tell us why, and Cúntas will skip “{card.title}”. You can bring it back from Next steps.</p>
        <Field label="Reason">{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Covered by a defined-benefit scheme" />}</Field>
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={() => setDismissing(false)}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              update((ds) => ({
                ...ds,
                stepStates: [...ds.stepStates, { id: newId("step"), memberId: card.member ?? null, stepId: card.check, status: "dismissed", dismissedReason: reason || "Not relevant", evaluatedAt: new Date().toISOString() }],
              }), `step.dismiss:${card.check}`);
              setDismissing(false);
            }}
          >
            Skip this step
          </Button>
        </div>
      </Modal>
    </Card>
  );
}
