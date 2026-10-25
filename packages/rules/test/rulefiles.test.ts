import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  CHECK_POLICY,
  MANIFEST,
  comparePacks,
  figuresNote,
  fingerprint,
  formatMoney,
  getPack,
  iePayroll,
  listPacks,
  nextYearDraft,
  packCheckState,
  packOn,
  parseRuleFile,
  previousPack,
  rulePrompts,
  setLoadedPacks,
  taxYearRange,
  toMinor,
  type CheckPolicy,
  type LoadedPack,
  type PackCheck,
} from "../src";
import { RAW_PACKS } from "../src/packs/generated";

const rulesDir = `${__dirname}/../rules`;
const yamlOf = (key: string) => readFileSync(`${rulesDir}/${key}.yaml`, "utf8");

/** A loaded copy of a built-in pack with figures changed. */
function edited(key: string, edit: (text: string) => string): string {
  return edit(yamlOf(key));
}

async function load(text: string): Promise<LoadedPack> {
  const r = parseRuleFile(text);
  if (!r.ok) throw new Error(r.errors.map((e) => `${e.line}: ${e.message}`).join("\n"));
  return { key: r.key, pack: r.pack, fingerprint: await fingerprint(text) };
}

afterEach(() => setLoadedPacks([]));

describe("money", () => {
  it("formats US dollars", () => {
    expect(formatMoney(123456, "USD")).toBe("$1,234.56");
    expect(formatMoney(-5000, "USD", { decimals: false })).toBe("−$50");
  });
});

describe("rule file schema", () => {
  it("accepts every built-in tax pack", () => {
    for (const key of Object.keys(RAW_PACKS)) {
      if (key.endsWith("/flowchart") || key.startsWith("xb/")) continue;
      const r = parseRuleFile(yamlOf(key));
      expect(r.ok ? r.key : r.errors, key).toBe(key);
    }
  });

  it("fingerprints a file the same way as the build manifest", async () => {
    const entry = MANIFEST.find((m) => m.key === "ie/2027")!;
    expect(await fingerprint(yamlOf("ie/2027"))).toBe(entry.sha256);
  });

  it("names the line of a rate outside 0 to 1", () => {
    const text = edited("ie/2027", (t) => t.replace("rates: { standard: 0.20, higher: 0.40 }", "rates: { standard: 20, higher: 0.40 }"));
    const r = parseRuleFile(text);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const line = text.split("\n").findIndex((l) => l.includes("standard: 20")) + 1;
    expect(r.errors).toContainEqual(expect.objectContaining({ line, path: "incomeTax.rates.standard" }));
  });

  it("rejects bands that do not rise, and a top band with a limit", () => {
    const falling = edited("uk/2027-28", (t) => t.replace("{ upTo: 125140, rate: 0.40 }", "{ upTo: 30000, rate: 0.40 }"));
    const r1 = parseRuleFile(falling);
    expect(!r1.ok && r1.errors.some((e) => e.path === "incomeTax.bands.1.upTo" && /rising/.test(e.message))).toBe(true);
    const capped = edited("uk/2027-28", (t) => t.replace("{ upTo: null, rate: 0.45 }", "{ upTo: 200000, rate: 0.45 }"));
    const r2 = parseRuleFile(capped);
    expect(!r2.ok && r2.errors.some((e) => e.path === "incomeTax.bands.2.upTo")).toBe(true);
  });

  it("requires a source link on every section", () => {
    const text = edited("ie/2027", (t) => t.replace(/^dirt:\n {2}source: .*\n/m, "dirt:\n"));
    const r = parseRuleFile(text);
    expect(!r.ok && r.errors.some((e) => e.path === "dirt.source")).toBe(true);
  });

  it("requires the tax year to match the effective dates", () => {
    const text = edited("ie/2027", (t) => t.replace('taxYear: "2027"', 'taxYear: "2028"'));
    const r = parseRuleFile(text);
    expect(!r.ok && r.errors.some((e) => e.path === "effective" && e.line !== null)).toBe(true);
  });

  it("reports YAML syntax errors with a line and changes nothing", () => {
    const r = parseRuleFile("jurisdiction: IE\ntaxYear: [2027\n");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.line).toBeGreaterThan(0);
    expect(listPacks("IE")).toHaveLength(2);
  });

  it("rejects files that are not tax packs", () => {
    const r = parseRuleFile(yamlOf("ie/flowchart"));
    expect(!r.ok && r.errors[0]!.message).toMatch(/jurisdiction/);
  });

  it("knows each jurisdiction's tax year dates", () => {
    expect(taxYearRange("IE", "2027")).toEqual({ from: "2027-01-01", to: "2027-12-31" });
    expect(taxYearRange("UK", "2027-28")).toEqual({ from: "2027-04-06", to: "2028-04-05" });
  });
});

describe("rule pack registry", () => {
  it("a loaded file replaces the built-in pack for its year, and removing it restores the built-in", async () => {
    const before = iePayroll(getPack("IE", "2027"), { grossAnnualMinor: toMinor(50000), frequency: "monthly", age: 35, assessment: "single", employment: "employee" });
    const text = edited("ie/2027", (t) => t.replace("version: \"IE-2027.1\"", "version: \"IE-2027.9\"").replace("rates: { standard: 0.20, higher: 0.40 }", "rates: { standard: 0.20, higher: 0.50 }"));
    setLoadedPacks([await load(text)]);
    expect(getPack("IE", "2027").version).toBe("IE-2027.9");
    expect(packOn("IE", "2027-06-01").version).toBe("IE-2027.9");
    const after = iePayroll(getPack("IE", "2027"), { grossAnnualMinor: toMinor(50000), frequency: "monthly", age: 35, assessment: "single", employment: "employee" });
    expect(after.incomeTaxMinor).toBeGreaterThan(before.incomeTaxMinor);
    setLoadedPacks([]);
    expect(getPack("IE", "2027").version).not.toBe("IE-2027.9");
  });

  it("a loaded file for a new year is used from the start of that year only", async () => {
    const draft = nextYearDraft("ie/2027", "2027-11-02");
    setLoadedPacks([await load(draft.text)]);
    expect(packOn("IE", "2028-02-01").taxYear).toBe("2028");
    expect(packOn("IE", "2027-12-31").taxYear).toBe("2027");
  });

  it("finds last year's pack for comparison", () => {
    expect(previousPack("ie/2027")?.taxYear).toBe("2026");
    expect(previousPack("ie/2026")).toBeUndefined();
  });
});

describe("checks and labels", () => {
  const userPolicy: CheckPolicy = { ...CHECK_POLICY, IE: { checkedBy: "user", nextYearHint: "11-01" } };

  it("built-in packs we maintain need no check; loaded files do until every section is ticked", async () => {
    expect(packCheckState("ie/2027", []).needsCheck).toBe(false);
    const loaded = await load(edited("ie/2027", (t) => t.replace("IE-2027.1", "IE-2027.2")));
    setLoadedPacks([loaded]);
    const state = packCheckState("ie/2027", []);
    expect(state).toMatchObject({ needsCheck: true, checked: false });
    const partial: PackCheck = { key: "ie/2027", fingerprint: loaded.fingerprint, checkedAt: "2027-01-03", sections: ["incomeTax"] };
    expect(packCheckState("ie/2027", [partial]).checked).toBe(false);
    const all: PackCheck = { ...partial, sections: state.sections };
    expect(packCheckState("ie/2027", [all]).checked).toBe(true);
    // A changed file has a new fingerprint and needs checking again.
    expect(packCheckState("ie/2027", [{ ...all, fingerprint: "0".repeat(64) }]).checked).toBe(false);
  });

  it("labels results that use unchecked figures or last year's figures", async () => {
    expect(figuresNote("IE", "2027-03-01", []).label).toBeNull();
    expect(figuresNote("IE", "2028-03-01", []).label).toBe("Figures not checked: uses 2027 figures");
    expect(figuresNote("IE", "2027-03-01", [], userPolicy).label).toBe("Figures not checked (2027)");
    const loaded = await load(edited("ie/2027", (t) => t.replace("IE-2027.1", "IE-2027.2")));
    setLoadedPacks([loaded]);
    expect(figuresNote("IE", "2027-03-01", []).label).toBe("Figures not checked (2027)");
  });

  it("covers the Scottish sub-pack for a Scottish taxpayer", () => {
    expect(figuresNote("UK", "2027-05-01", [], CHECK_POLICY, "scotland").label).toBe("Figures not checked: uses 2026-27 Scottish figures");
  });

  it("asks for a check while the current year is unchecked, under the you-check model", () => {
    const prompts = rulePrompts({ needs: [{ jurisdiction: "IE" }], today: "2027-01-02", checks: [], policy: userPolicy });
    expect(prompts).toEqual([
      expect.objectContaining({ kind: "check", taxYear: "2027", message: "Check your 2027 Irish tax figures. Until you do, results use figures you haven't checked." }),
    ]);
    const key = "ie/2027";
    const fp = MANIFEST.find((m) => m.key === key)!.sha256;
    const checks: PackCheck[] = [{ key, fingerprint: fp, checkedAt: "2027-01-02", sections: packCheckState(key, []).sections }];
    expect(rulePrompts({ needs: [{ jurisdiction: "IE" }], today: "2027-01-02", checks, policy: userPolicy })).toEqual([]);
  });

  it("says next year's figures are usually out from 1 November, until dismissed", () => {
    const fp = MANIFEST.find((m) => m.key === "ie/2027")!.sha256;
    const checks: PackCheck[] = [{ key: "ie/2027", fingerprint: fp, checkedAt: "2027-01-02", sections: packCheckState("ie/2027", []).sections }];
    const base = { needs: [{ jurisdiction: "IE" as const }], checks, policy: userPolicy };
    expect(rulePrompts({ ...base, today: "2027-10-31" })).toEqual([]);
    const [p] = rulePrompts({ ...base, today: "2027-11-01" });
    expect(p).toMatchObject({ kind: "nextYearOut", taxYear: "2028", dismissible: true, message: "2028 Irish tax figures are usually out by now. Add them when you're ready." });
    expect(rulePrompts({ ...base, today: "2027-11-05", dismissed: { [p!.id]: "2027-12-01" } })).toEqual([]);
    expect(rulePrompts({ ...base, today: "2027-12-02", dismissed: { [p!.id]: "2027-12-01" } })).toHaveLength(1);
  });

  it("US figures are yours to check: prompts until 2026 is checked, then for 2027 from 1 November", () => {
    expect(rulePrompts({ needs: [{ jurisdiction: "US" }], today: "2026-10-24", checks: [] })).toEqual([
      expect.objectContaining({ kind: "check", taxYear: "2026", message: "Check your 2026 US tax figures. Until you do, results use figures you haven't checked." }),
    ]);
    const key = "us/2026";
    const fp = MANIFEST.find((m) => m.key === key)!.sha256;
    const checks: PackCheck[] = [{ key, fingerprint: fp, checkedAt: "2026-10-24", sections: packCheckState(key, []).sections }];
    expect(rulePrompts({ needs: [{ jurisdiction: "US" }], today: "2026-10-24", checks })).toEqual([]);
    expect(rulePrompts({ needs: [{ jurisdiction: "US" }], today: "2026-11-01", checks })).toEqual([
      expect.objectContaining({ kind: "nextYearOut", taxYear: "2027", message: "2027 US tax figures are usually out by now. Add them when you're ready." }),
    ]);
    expect(figuresNote("US", "2026-10-24", [])?.label).toBe("Figures not checked (2026)");
  });

  it("a US draft for 2027 loads back through the schema", () => {
    const draft = nextYearDraft("us/2026", "2026-11-02");
    expect(draft.filename).toBe("us-2027.yaml");
    const r = parseRuleFile(draft.text);
    expect(r.ok && r.key).toBe("us/2027");
  });

  it("no prompts for packs we maintain", () => {
    expect(rulePrompts({ needs: [{ jurisdiction: "IE" }, { jurisdiction: "UK", region: "scotland" }], today: "2027-11-02", checks: [] })).toEqual([]);
  });
});

describe("next year's draft", () => {
  it("moves the year and dates on, marks it provisional and every section to check", () => {
    const draft = nextYearDraft("ie/2027", "2027-11-02");
    expect(draft.filename).toBe("ie-2028.yaml");
    const data = parse(draft.text) as { taxYear: string; version: string; status: string; effective: unknown; prsi: { classA1: { from: string; rate: number }[] } };
    expect(data).toMatchObject({ taxYear: "2028", version: "IE-2028.0", status: "provisional", effective: { from: "2028-01-01", to: "2028-12-31" } });
    // Mid-year rate changes collapse to the rate in force at the end of last year, from the new year's start.
    const last = (getPack("IE", "2027").prsi.classA1.at(-1)!).rate;
    expect(data.prsi.classA1).toEqual([{ from: "2028-01-01", rate: last }]);
    expect(draft.text).toMatch(/# CHECK: every figure in incomeTax against https:\/\//);
    expect(parseRuleFile(draft.text).ok).toBe(true);
  });

  it("works for UK and Scottish packs", () => {
    expect(nextYearDraft("uk/2027-28", "2027-11-02")).toMatchObject({ key: "uk/2028-29", filename: "uk-2028-29.yaml" });
    const sct = nextYearDraft("uk/scotland/2026-27", "2027-01-02");
    expect(sct.key).toBe("uk/scotland/2027-28");
    expect(parseRuleFile(sct.text)).toMatchObject({ ok: true, key: "uk/scotland/2027-28" });
  });

  it("compares each figure with last year's", () => {
    const sections = comparePacks(RAW_PACKS["ie/2026"], RAW_PACKS["ie/2027"]);
    const income = sections.find((s) => s.key === "incomeTax")!;
    expect(income.source).toMatch(/^https:\/\//);
    expect(income.rows).toContainEqual({ path: "standardRateBand.single", before: 44000, after: 46500, changed: true });
    expect(income.rows).toContainEqual({ path: "rates.standard", before: 0.2, after: 0.2, changed: false });
  });
});
