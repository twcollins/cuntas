import type { IsoDate } from "../dates";
import { packByKey, packFingerprint, packKey, packOn, packOrigin, regionPackFor, statePackFor } from "./registry";
import { packSections } from "./schema";
import { parentOf, type Jurisdiction, type RulePack } from "./types";
import { isUsState, US_STATES, type UsState } from "../usStates";
import { nextTaxYear, taxYearOf } from "./years";

// Who checks the figures. Packs we maintain ship in the app; under the you-check model (the US) the
// user checks each year's figures against the official sources. A rule file the user
// loads always needs their check, whatever the jurisdiction.

export interface JurisdictionPolicy {
  checkedBy: "maintainer" | "user";
  /** Month-day from which next year's figures are usually published, e.g. "11-01". */
  nextYearHint?: string;
}
export type CheckPolicy = Record<Jurisdiction, JurisdictionPolicy>;

export const CHECK_POLICY: CheckPolicy = {
  IE: { checkedBy: "maintainer" },
  UK: { checkedBy: "maintainer" },
  US: { checkedBy: "user", nextYearHint: "11-01" },
};

/** The record of a user checking a pack: which file (by fingerprint), when, and which sections. */
export interface PackCheck {
  key: string;
  fingerprint: string;
  checkedAt: IsoDate;
  sections: string[];
}

export interface PackCheckState {
  /** The figures are the user's to check: a loaded file, or a jurisdiction under the you-check model. */
  needsCheck: boolean;
  /** Every section is ticked for this exact file. */
  checked: boolean;
  sections: string[];
  sectionsChecked: string[];
  check?: PackCheck;
}

const TAX_LABEL: Record<Jurisdiction | "scotland", string> = { IE: "Irish", UK: "UK", US: "US", scotland: "Scottish" };
/** "Irish", "Scottish", "California". */
const labelOf = (region: string): string => (region in TAX_LABEL ? TAX_LABEL[region as keyof typeof TAX_LABEL] : (US_STATES[region.toUpperCase() as UsState] ?? region));

/** A sub-pack's key for a need: "uk/scotland/2027-28" or "us/ca/2027". */
const subKey = (j: Jurisdiction, region: string, year: string) => `${j.toLowerCase()}/${region.toLowerCase()}/${year}`;

export function packCheckState(key: string, checks: readonly PackCheck[], policy: CheckPolicy = CHECK_POLICY): PackCheckState {
  const pack = packByKey(key);
  if (!pack) return { needsCheck: false, checked: false, sections: [], sectionsChecked: [] };
  const sections = packSections(pack);
  const fp = packFingerprint(key);
  const check = checks.find((c) => c.key === key && c.fingerprint === fp);
  const sectionsChecked = check ? sections.filter((s) => check.sections.includes(s)) : [];
  const needsCheck = packOrigin(key) === "file" || policy[parentOf(pack)].checkedBy === "user";
  return { needsCheck, checked: sectionsChecked.length === sections.length, sections, sectionsChecked, check };
}

export interface FiguresNote {
  pack: RulePack;
  key: string;
  /** The pack's year matches the date's tax year. */
  sameYear: boolean;
  /** "Figures not checked (2027)", or "Figures not checked: uses 2026 figures"; null when nothing to say. */
  label: string | null;
}

/** What to say next to a result calculated with the figures in use on a date. */
export function figuresNote(
  jurisdiction: Jurisdiction,
  date: IsoDate,
  checks: readonly PackCheck[],
  policy: CheckPolicy = CHECK_POLICY,
  region?: string,
): FiguresNote {
  const pack = packOn(jurisdiction, date);
  const key = packKey(pack);
  const year = taxYearOf(jurisdiction, date);
  const sameYear = pack.taxYear === year;
  const state = packCheckState(key, checks, policy);
  let label: string | null = null;
  if (!sameYear) label = `Figures not checked: uses ${pack.taxYear} figures`;
  else if (state.needsCheck && !state.checked) label = `Figures not checked (${pack.taxYear})`;
  if (!label && region) {
    const sub = jurisdiction === "UK" ? regionPackFor(region as "scotland", year) : isUsState(region.toUpperCase()) ? statePackFor(region.toUpperCase() as UsState, year) : null;
    if (sub) {
      const rs = packCheckState(packKey(sub.pack), checks, policy);
      if (!sub.exact) label = `Figures not checked: uses ${sub.pack.taxYear} ${labelOf(region)} figures`;
      else if (rs.needsCheck && !rs.checked) label = `Figures not checked (${sub.pack.taxYear} ${labelOf(region)})`;
    }
  }
  return { pack, key, sameYear, label };
}

export interface RuleNeed {
  jurisdiction: Jurisdiction;
  /** A sub-pack the household also needs: "scotland", or a US state code such as "CA". */
  region?: string;
}

export interface RulePrompt {
  id: string;
  kind: "check" | "nextYearOut";
  key: string;
  jurisdiction: Jurisdiction;
  taxYear: string;
  message: string;
  dismissible: boolean;
}

/**
 * Prompts for the household's tax rules: check this year's figures while they are unchecked, and,
 * from the date next year's figures are usually out, add them. `dismissed` maps prompt id to the
 * last day it stays hidden.
 */
export function rulePrompts(input: {
  needs: readonly RuleNeed[];
  today: IsoDate;
  checks: readonly PackCheck[];
  dismissed?: Record<string, IsoDate>;
  policy?: CheckPolicy;
}): RulePrompt[] {
  const { today, checks, dismissed = {}, policy = CHECK_POLICY } = input;
  const out = new Map<string, RulePrompt>();
  for (const need of input.needs) {
    const j = need.jurisdiction;
    const year = taxYearOf(j, today);
    const units = [{ key: `${j.toLowerCase()}/${year}`, label: TAX_LABEL[j] }];
    if (need.region) units.push({ key: subKey(j, need.region, year), label: labelOf(need.region) });
    for (const u of units) {
      const exists = packByKey(u.key) !== undefined;
      const state = packCheckState(u.key, checks, policy);
      if ((exists && state.needsCheck && !state.checked) || (!exists && policy[j].checkedBy === "user")) {
        const id = `check:${u.key}`;
        out.set(id, { id, kind: "check", key: u.key, jurisdiction: j, taxYear: year, dismissible: false, message: `Check your ${year} ${u.label} tax figures. Until you do, results use figures you haven't checked.` });
      }
    }
    const hint = policy[j].nextYearHint;
    if (policy[j].checkedBy === "user" && hint && today.slice(5) >= hint) {
      const next = nextTaxYear(j, year);
      const nextUnits = [{ key: `${j.toLowerCase()}/${next}`, label: TAX_LABEL[j] }];
      if (need.region) nextUnits.push({ key: subKey(j, need.region, next), label: labelOf(need.region) });
      for (const u of nextUnits) {
        const id = `next:${u.key}`;
        const hiddenUntil = dismissed[id];
        if (!packByKey(u.key) && !(hiddenUntil && hiddenUntil >= today)) {
          out.set(id, { id, kind: "nextYearOut", key: u.key, jurisdiction: j, taxYear: next, dismissible: true, message: `${next} ${u.label} tax figures are usually out by now. Add them when you're ready.` });
        }
      }
    }
  }
  return [...out.values()];
}
