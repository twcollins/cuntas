import { COUNTRY_INFO, type Country } from "../../countries";
import { treatyFor } from "../../packs";

export type CrossBorderItem =
  | { kind: "employment"; workCountry: Country; homeWorkdays?: number }
  | { kind: "privatePension"; sourceCountry: Country }
  | { kind: "governmentPension"; sourceCountry: Country }
  | { kind: "statePension"; sourceCountry: Country }
  | { kind: "isa" }
  | { kind: "deposit"; accountCountry: Country };

export interface CrossBorderMember {
  residence: Country;
  nationality: readonly Country[];
  /** The other country in view (for a move, where the member lives now). Picks the treaty for items that stay within the residence country. */
  counterpart?: Country;
}

export type TaxMethod = "residence-only" | "source-only" | "source-with-credit" | "taxable-no-wrapper-exemption" | "domestic";

export interface Classification {
  taxedBy: Country[];
  primary: Country;
  method: TaxMethod;
  reference: { ref: string; source: string };
  notes: string[];
  flags: string[];
}

const DEFAULT_PARTNER: Record<Country, Country> = { IE: "UK", UK: "IE", US: "IE" };
const ACCOUNT: Record<Country, string> = { IE: "an Irish", UK: "a UK", US: "a US" };
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Decides which jurisdiction taxes an item for a member in a year. Residence is declared by the user. */
export function classify(item: CrossBorderItem, member: CrossBorderMember, taxYear: string): Classification {
  const c = classifyByResidence(item, member, taxYear);
  return item.kind === "statePension" ? c : withUsCitizenship(c, member);
}

function classifyByResidence(item: CrossBorderItem, member: CrossBorderMember, taxYear: string): Classification {
  const res = member.residence;
  // The treaty between the residence and another country; for an item within one country, the counterpart's.
  const t = (other: Country) => {
    const partner = other !== res ? other : member.counterpart && member.counterpart !== res ? member.counterpart : DEFAULT_PARTNER[res];
    return treatyFor(res, partner);
  };
  const notes: string[] = [`Tax year ${taxYear}; residence ${res} as declared.`];

  switch (item.kind) {
    case "employment": {
      const work = item.workCountry;
      const tr = t(work);
      if (work === res) {
        return { taxedBy: [res], primary: res, method: "domestic", reference: tr.articles.employment, notes, flags: [] };
      }
      const flags: string[] = [];
      if (res === "IE" && work === "UK") {
        notes.push("UK taxes the pay; Ireland taxes it too and credits the UK tax.");
        notes.push("Trans-border workers relief can remove the Irish top-up if the conditions are met.");
        flags.push("trans-border-relief-check");
        if ((item.homeWorkdays ?? 0) > 0) {
          flags.push("home-workdays-may-lose-relief");
          notes.push(`${item.homeWorkdays} working days at home in Ireland may cost the relief.`);
        }
        return { taxedBy: [work, res], primary: work, method: "source-with-credit", reference: tr.transBorderRelief ?? tr.articles.eliminationOfDoubleTax, notes, flags };
      }
      if (res === "UK" && work === "IE") {
        notes.push("Ireland taxes the pay; the UK has no equivalent relief and may collect a top-up via self assessment.");
        flags.push("uk-self-assessment-top-up");
        return { taxedBy: [work, res], primary: work, method: "source-with-credit", reference: tr.articles.eliminationOfDoubleTax, notes, flags };
      }
      notes.push(`${capital(COUNTRY_INFO[work].inSentence)} taxes pay for work done there; ${COUNTRY_INFO[res].inSentence} taxes it too and credits that tax.`);
      notes.push(`Days you work while in ${COUNTRY_INFO[res].inSentence} are taxed there first (${tr.articles.employment.ref}).`);
      flags.push("foreign-tax-credit");
      return { taxedBy: [work, res], primary: work, method: "source-with-credit", reference: tr.articles.eliminationOfDoubleTax, notes, flags };
    }
    case "privatePension":
    case "statePension": {
      const src = item.sourceCountry;
      const tr = t(src);
      if (src !== res) {
        notes.push(`Taxable only in ${res}.`);
        if (src === "UK") notes.push("Claim relief at source from HMRC so UK tax is not deducted.");
        if (src === "UK" && item.kind === "privatePension" && tr.articles.lumpSum) {
          notes.push(`A lump sum is taxed only as the UK would tax it, so the tax-free part stays tax-free (${tr.articles.lumpSum.ref}).`);
        }
      }
      return {
        taxedBy: [res],
        primary: res,
        method: src === res ? "domestic" : "residence-only",
        reference: (item.kind === "statePension" && tr.articles.socialSecurity) || tr.articles.privatePension,
        notes,
        flags: src === "UK" && res !== "UK" ? ["claim-hmrc-relief-at-source"] : [],
      };
    }
    case "governmentPension": {
      const src = item.sourceCountry;
      const tr = t(src);
      const resNational = member.nationality.includes(res);
      if (src === res) {
        return { taxedBy: [res], primary: res, method: "domestic", reference: tr.articles.governmentService, notes, flags: [] };
      }
      if (resNational) {
        notes.push(`Resident in and a national of ${res}, so taxable only in ${res}.`);
        return { taxedBy: [res], primary: res, method: "residence-only", reference: tr.articles.governmentService, notes, flags: [] };
      }
      notes.push(`Generally taxable only in ${src}.`);
      return { taxedBy: [src], primary: src, method: "source-only", reference: tr.articles.governmentService, notes, flags: [] };
    }
    case "isa": {
      const tr = t("UK");
      if (res === "UK") {
        return { taxedBy: [], primary: "UK", method: "domestic", reference: treatyFor("UK", "IE").isa!, notes: [...notes, "ISA wrapper exempt in the UK."], flags: [] };
      }
      if (res === "US") {
        notes.push("The US gives no exemption for ISAs: interest, dividends and gains inside one are taxable in the US each year.");
        notes.push("Funds in an ISA are usually PFICs: heavier US tax unless an election is made, and Form 8621 for each fund.");
        return { taxedBy: [res], primary: res, method: "taxable-no-wrapper-exemption", reference: tr.isa!, notes, flags: ["isa-not-exempt", "check-pfic-funds"] };
      }
      notes.push("Ireland gives no exemption for UK ISAs: income and gains are taxable in Ireland.");
      notes.push("Fund holdings may fall under exit tax and deemed disposal.");
      return { taxedBy: [res], primary: res, method: "taxable-no-wrapper-exemption", reference: tr.isa!, notes, flags: ["isa-not-exempt", "check-exit-tax-funds"] };
    }
    case "deposit": {
      const tr = t(item.accountCountry);
      if (item.accountCountry === res) {
        return { taxedBy: [res], primary: res, method: "domestic", reference: tr.articles.interest, notes, flags: [] };
      }
      notes.push(`Interest on ${ACCOUNT[item.accountCountry]} account is taxable in ${res}; declare it on your return.`);
      const flags = ["foreign-deposit-declare"];
      if (res === "US") {
        notes.push("US residents report foreign accounts each year (FBAR, and Form 8938 above higher limits).");
        flags.push("us-foreign-account-reporting");
      }
      return { taxedBy: [res], primary: res, method: "residence-only", reference: tr.articles.interest, notes, flags };
    }
  }
}

/**
 * The US taxes its citizens wherever they live (the treaties' saving clause). State pensions are
 * outside the clause, so the caller skips them.
 */
function withUsCitizenship(c: Classification, member: CrossBorderMember): Classification {
  if (member.residence === "US" || !member.nationality.includes("US") || c.taxedBy.includes("US")) return c;
  const clause = treatyFor(member.residence, "US").articles.savingClause;
  return {
    ...c,
    taxedBy: [...c.taxedBy, "US"],
    notes: [...c.notes, `As a US citizen you report this to the US wherever you live, and the US can tax it${clause ? ` (${clause.ref})` : ""}; credit for tax paid here usually reduces the US bill.`],
    flags: [...c.flags, "us-citizen-worldwide"],
  };
}
