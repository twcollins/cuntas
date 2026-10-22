import { treaty, type Jurisdiction } from "../../packs";

export type CrossBorderItem =
  | { kind: "employment"; workCountry: Jurisdiction; homeWorkdays?: number }
  | { kind: "privatePension"; sourceCountry: Jurisdiction }
  | { kind: "governmentPension"; sourceCountry: Jurisdiction }
  | { kind: "statePension"; sourceCountry: Jurisdiction }
  | { kind: "isa" }
  | { kind: "deposit"; accountCountry: Jurisdiction };

export interface CrossBorderMember {
  residence: Jurisdiction;
  nationality: readonly Jurisdiction[];
}

export type TaxMethod = "residence-only" | "source-only" | "source-with-credit" | "taxable-no-wrapper-exemption" | "domestic";

export interface Classification {
  taxedBy: Jurisdiction[];
  primary: Jurisdiction;
  method: TaxMethod;
  reference: { ref: string; source: string };
  notes: string[];
  flags: string[];
}

const other = (j: Jurisdiction): Jurisdiction => (j === "IE" ? "UK" : "IE");

/** Decides which jurisdiction taxes an item for a member in a year. Residence is declared by the user. */
export function classify(item: CrossBorderItem, member: CrossBorderMember, taxYear: string): Classification {
  const t = treaty();
  const res = member.residence;
  const notes: string[] = [`Tax year ${taxYear}; residence ${res} as declared.`];

  switch (item.kind) {
    case "employment": {
      if (item.workCountry === res) {
        return { taxedBy: [res], primary: res, method: "domestic", reference: t.articles.employment, notes, flags: [] };
      }
      const flags: string[] = [];
      if (res === "IE") {
        notes.push("UK taxes the pay; Ireland taxes it too and credits the UK tax.");
        notes.push("Trans-border workers relief can remove the Irish top-up if the conditions are met.");
        flags.push("trans-border-relief-check");
        if ((item.homeWorkdays ?? 0) > 0) {
          flags.push("home-workdays-may-lose-relief");
          notes.push(`${item.homeWorkdays} working days at home in Ireland may cost the relief.`);
        }
        return { taxedBy: [item.workCountry, res], primary: item.workCountry, method: "source-with-credit", reference: t.transBorderRelief, notes, flags };
      }
      notes.push("Ireland taxes the pay; the UK has no equivalent relief and may collect a top-up via self assessment.");
      flags.push("uk-self-assessment-top-up");
      return { taxedBy: [item.workCountry, res], primary: item.workCountry, method: "source-with-credit", reference: t.articles.eliminationOfDoubleTax, notes, flags };
    }
    case "privatePension":
    case "statePension": {
      if (item.sourceCountry !== res) {
        notes.push(`Taxable only in ${res}.`);
        if (item.sourceCountry === "UK") notes.push("Claim relief at source from HMRC so UK tax is not deducted.");
      }
      return {
        taxedBy: [res],
        primary: res,
        method: item.sourceCountry === res ? "domestic" : "residence-only",
        reference: t.articles.privatePension,
        notes,
        flags: item.sourceCountry === "UK" && res === "IE" ? ["claim-hmrc-relief-at-source"] : [],
      };
    }
    case "governmentPension": {
      const resNational = member.nationality.includes(res);
      if (item.sourceCountry === res) {
        return { taxedBy: [res], primary: res, method: "domestic", reference: t.articles.governmentService, notes, flags: [] };
      }
      if (resNational) {
        notes.push(`Resident in and a national of ${res}, so taxable only in ${res}.`);
        return { taxedBy: [res], primary: res, method: "residence-only", reference: t.articles.governmentService, notes, flags: [] };
      }
      notes.push(`Generally taxable only in ${item.sourceCountry}.`);
      return { taxedBy: [item.sourceCountry], primary: item.sourceCountry, method: "source-only", reference: t.articles.governmentService, notes, flags: [] };
    }
    case "isa": {
      if (res === "UK") {
        return { taxedBy: [], primary: "UK", method: "domestic", reference: t.isa, notes: [...notes, "ISA wrapper exempt in the UK."], flags: [] };
      }
      notes.push("Ireland gives no exemption for UK ISAs: income and gains are taxable in Ireland.");
      notes.push("Fund holdings may fall under exit tax and deemed disposal.");
      return { taxedBy: [res], primary: res, method: "taxable-no-wrapper-exemption", reference: t.isa, notes, flags: ["isa-not-exempt", "check-exit-tax-funds"] };
    }
    case "deposit": {
      if (item.accountCountry === res) {
        return { taxedBy: [res], primary: res, method: "domestic", reference: t.articles.interest, notes, flags: [] };
      }
      notes.push(`Interest on a ${item.accountCountry} account is taxable in ${res}; declare it on your return.`);
      return { taxedBy: [res], primary: res, method: "residence-only", reference: t.articles.interest, notes, flags: [other(res) === item.accountCountry ? "foreign-deposit-declare" : ""].filter(Boolean) };
    }
  }
}
