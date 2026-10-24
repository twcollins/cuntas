import type { StudentLoanPlan } from "@cuntas/rules";

const PLANS: { value: StudentLoanPlan; label: string }[] = [
  { value: "plan1", label: "Plan 1" },
  { value: "plan2", label: "Plan 2" },
  { value: "plan4", label: "Plan 4 (Scotland)" },
  { value: "plan5", label: "Plan 5" },
  { value: "postgraduate", label: "Postgraduate" },
];

export function StudentLoanPicker({ value, onChange }: { value: readonly StudentLoanPlan[]; onChange: (plans: StudentLoanPlan[]) => void }) {
  return (
    <fieldset className="text-sm">
      <legend className="mb-1 text-xs font-medium text-stone-600 dark:text-stone-400">UK student loans</legend>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {PLANS.map((p) => (
          <label key={p.value} className="inline-flex items-center gap-1">
            <input type="checkbox" checked={value.includes(p.value)} onChange={(e) => onChange(e.target.checked ? [...value, p.value] : value.filter((x) => x !== p.value))} />
            {p.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
