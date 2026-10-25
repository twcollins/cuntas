import { describe, expect, it } from "vitest";
import {
  applyRate,
  classify,
  getPack,
  ieCgt,
  ieDeemedDisposals,
  ieExitTax,
  ieHelpToBuy,
  ieInvestmentAccount,
  iePayroll,
  iePrsi,
  ieUsc,
  myFutureFundStatus,
  packOn,
  payDates,
  pensionReliefHeadroom,
  splitEvenly,
  taxYearOf,
  toMinor,
  ukIsaTransferAllowed,
  ukNiGapCheck,
  ukPayroll,
  ukSavingsTax,
  treaty,
  treatyFor,
} from "../src";

const ie26 = getPack("IE", "2026");
const ie27 = getPack("IE", "2027");
const uk26 = getPack("UK", "2026-27");
const uk27 = getPack("UK", "2027-28");

describe("money", () => {
  it("applies rates without float drift", () => {
    expect(applyRate(416667, 0.0435)).toBe(18125);
    expect(applyRate(10, 0.05)).toBe(1); // 0.5 rounds half up
    expect(applyRate(-10, 0.05)).toBe(-1);
  });
  it("splits evenly to the cent", () => {
    const parts = splitEvenly(5000000, 12);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(5000000);
  });
});

describe("pack registry", () => {
  it("picks packs by date and tax year", () => {
    expect(packOn("IE", "2026-06-01").version).toBe("IE-2026.3");
    expect(packOn("UK", "2027-04-05").taxYear).toBe("2026-27");
    expect(packOn("UK", "2027-04-06").taxYear).toBe("2027-28");
    expect(taxYearOf("UK", "2027-04-05")).toBe("2026-27");
    expect(taxYearOf("IE", "2027-04-05")).toBe("2027");
  });
});

describe("ie.payroll", () => {
  it("applies PRSI by pay date, switching on 1 October", () => {
    const periods = iePrsi(ie27, toMinor(50000), "monthly");
    expect(periods.filter((p) => p.rate === 0.045).map((p) => p.payDate)).toEqual(["2027-10-31", "2027-11-30", "2027-12-31"]);
  });
  it("generates weekly pay dates on Fridays", () => {
    const dates = payDates(2027, "weekly");
    expect(dates[0]).toBe("2027-01-01");
    expect(dates.length).toBe(53);
  });
  it("exempts low earners from PRSI and USC", () => {
    const r = iePayroll(ie27, { grossAnnualMinor: toMinor(12000), frequency: "weekly", assessment: "single", employment: "employee", age: 20 });
    expect(r.prsiMinor).toBe(0);
    expect(r.uscMinor).toBe(0);
    expect(r.incomeTaxMinor).toBe(0);
  });
  it("tapers the PRSI credit between the weekly thresholds", () => {
    // EUR 380 a week: 4.35% = 16.53; credit 12 - (28/6) = 7.33; PRSI ~9.20 a week.
    const periods = iePrsi(ie27, toMinor(380) * 53, "weekly");
    expect(periods[0]!.prsiMinor).toBe(920);
  });
  it("relieves pension contributions for income tax but not USC", () => {
    const without = iePayroll(ie27, { grossAnnualMinor: toMinor(60000), frequency: "monthly", assessment: "single", employment: "employee", age: 35 });
    const withPension = iePayroll(ie27, {
      grossAnnualMinor: toMinor(60000), frequency: "monthly", assessment: "single", employment: "employee", age: 35,
      pensionEmployeeMinor: toMinor(3000),
    });
    expect(without.incomeTaxMinor - withPension.incomeTaxMinor).toBe(toMinor(1200));
    expect(withPension.uscMinor).toBe(without.uscMinor);
    expect(withPension.marginalRate).toBe(0.4);
  });
  it("deducts MyFutureFund with no tax relief", () => {
    const r = iePayroll(ie27, { grossAnnualMinor: toMinor(40000), frequency: "monthly", assessment: "single", employment: "employee", age: 30, myFutureFund: true });
    expect(r.myFutureFund).toEqual({ employeeMinor: 60000, employerMinor: 60000, stateMinor: 20000 });
    expect(r.taxableMinor).toBe(toMinor(40000));
  });
  it("widens the band for married two-income couples", () => {
    const r = iePayroll(ie27, {
      grossAnnualMinor: toMinor(60000), spouseGrossAnnualMinor: toMinor(40000), frequency: "monthly",
      assessment: "marriedTwoIncomes", employment: "employee", age: 40,
    });
    // Band 55,500 + min(37,500, 40,000) = 93,000; tax 18,600 + 2,800 - credits 8,500 = 12,900; 60% share.
    expect(r.incomeTaxMinor).toBe(toMinor(7740));
  });
  it("applies the rent credit at 20% up to the maximum", () => {
    const r = iePayroll(ie27, { grossAnnualMinor: toMinor(50000), frequency: "monthly", assessment: "single", employment: "employee", age: 30, rentPaidMinor: toMinor(15000) });
    expect(r.incomeTaxMinor).toBe(toMinor(6450 - 1150));
  });
  it("adds the self-employed USC surcharge above EUR 100,000", () => {
    const r = ieUsc(ie27, toMinor(120000), toMinor(120000));
    const plain = ieUsc(ie27, toMinor(120000));
    expect(r.amountMinor - plain.amountMinor).toBe(toMinor(600));
  });
});

describe("ie.pensionRelief", () => {
  it("computes headroom, tax back and deadline", () => {
    const h = pensionReliefHeadroom(ie26, { age: 45, earningsMinor: toMinor(40000), contributedMinor: toMinor(3600), marginalRate: 0.4 });
    expect(h.headroomMinor).toBe(toMinor(6400));
    expect(h.taxBackMinor).toBe(toMinor(2560));
    expect(h.deadline).toBe("2027-10-31");
  });
  it("reports MyFutureFund status", () => {
    expect(myFutureFundStatus(ie27, { age: 30, grossAnnualMinor: toMinor(30000), inQualifyingScheme: false })).toBe("auto-enrolled");
    expect(myFutureFundStatus(ie27, { age: 22, grossAnnualMinor: toMinor(30000), inQualifyingScheme: false })).toBe("not-eligible-age");
    expect(myFutureFundStatus(ie27, { age: 30, grossAnnualMinor: toMinor(19000), inQualifyingScheme: false })).toBe("not-eligible-earnings");
  });
});

describe("investment taxes", () => {
  it("exit tax is 38% in 2026 and 35% in 2027, with no loss relief", () => {
    expect(ieExitTax(ie26, { gainMinor: toMinor(1000), date: "2026-05-01" }).taxMinor).toBe(toMinor(380));
    expect(ieExitTax(ie27, { gainMinor: toMinor(1000), date: "2027-05-01" }).taxMinor).toBe(toMinor(350));
    expect(ieExitTax(ie27, { gainMinor: -toMinor(1000), date: "2027-05-01" }).taxMinor).toBe(0);
  });
  it("CGT is 33% before and 31% from 7 October 2026", () => {
    const before = ieCgt(ie26, { disposals: [{ date: "2026-10-06", gainMinor: toMinor(11270) }] });
    expect(before.taxMinor).toBe(toMinor(3300));
    expect(before.disposals[0]!.dueDate).toBe("2026-12-15");
    const after = ieCgt(ie26, { disposals: [{ date: "2026-12-10", gainMinor: toMinor(11270) }] });
    expect(after.taxMinor).toBe(toMinor(3100));
    expect(after.disposals[0]!.dueDate).toBe("2027-01-31");
  });
  it("CGT offsets losses before the exemption", () => {
    const r = ieCgt(ie27, { disposals: [{ date: "2027-03-01", gainMinor: toMinor(5000) }, { date: "2027-04-01", gainMinor: -toMinor(2000) }] });
    expect(r.disposals[0]!.chargeableMinor).toBe(toMinor(5000 - 2000 - 1270));
  });
  it("schedules deemed disposal every 8 years per lot", () => {
    const events = ieDeemedDisposals({
      lots: [{ id: "a", date: "2019-03-15", units: 100, costMinor: toMinor(5000) }],
      unitPriceMinor: toMinor(80),
      from: "2026-01-01",
      until: "2034-12-31",
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ date: "2027-03-15", estimatedGainMinor: toMinor(3000), estimatedTaxMinor: toMinor(1050), paymentDeadline: "2028-10-31" });
  });
  it("Investment Account is feature-flagged and charges 1% above EUR 50,000", () => {
    const input = { date: "2027-08-01", averageValueMinor: toMinor(60000), contributionsThisYearMinor: toMinor(13000) };
    expect(ieInvestmentAccount(ie27, { ...input, flags: new Set() }).enabled).toBe(false);
    expect(ieInvestmentAccount(ie26, { ...input, flags: new Set(["investmentAccount"]) }).enabled).toBe(false);
    const on = ieInvestmentAccount(ie27, { ...input, flags: new Set(["investmentAccount"]) });
    expect(on).toMatchObject({ enabled: true, chargeMinor: toMinor(100), overContributionMinor: toMinor(1000) });
  });
  it("Help to Buy takes the lowest limit", () => {
    expect(ieHelpToBuy(ie27, { priceMinor: toMinor(400000), taxPaidLookbackMinor: toMinor(50000) })).toMatchObject({ reliefMinor: toMinor(35000), limitedBy: "maxRelief" });
    expect(ieHelpToBuy(ie27, { priceMinor: toMinor(300000), taxPaidLookbackMinor: toMinor(50000) }).limitedBy).toBe("priceRate");
    expect(ieHelpToBuy(ie27, { priceMinor: toMinor(400000), taxPaidLookbackMinor: toMinor(20000) }).limitedBy).toBe("taxPaid");
  });
});

describe("uk", () => {
  it("payroll at GBP 60,000", () => {
    const r = ukPayroll(uk26, { grossAnnualMinor: toMinor(60000) });
    expect(r.incomeTaxMinor).toBe(toMinor(11432));
    expect(r.niMinor).toBe(321060);
    expect(r.rateBand).toBe("higher");
  });
  it("tapers the personal allowance above GBP 100,000", () => {
    expect(ukPayroll(uk26, { grossAnnualMinor: toMinor(110000) }).personalAllowanceMinor).toBe(toMinor(7570));
    expect(ukPayroll(uk26, { grossAnnualMinor: toMinor(130000) }).personalAllowanceMinor).toBe(0);
  });
  it("savings tax rises 2 points from April 2027", () => {
    expect(ukSavingsTax(uk26, { interestMinor: toMinor(2000), band: "basic" }).taxMinor).toBe(toMinor(200));
    expect(ukSavingsTax(uk27, { interestMinor: toMinor(2000), band: "basic" }).taxMinor).toBe(toMinor(220));
  });
  it("blocks stocks-to-cash ISA transfers for under-65s from April 2027", () => {
    expect(ukIsaTransferAllowed(uk27, { age: 40, from: "stocksAndShares", to: "cash" })).toBe(false);
    expect(ukIsaTransferAllowed(uk26, { age: 40, from: "stocksAndShares", to: "cash" })).toBe(true);
  });
  it("NI gap check applies the 10-year rule abroad", () => {
    const r = ukNiGapCheck(uk26, { qualifyingYears: 8, yearsUntilStatePensionAge: 20, livingAbroad: true, ukLinkYears: 8, gapYearsToBuy: 5 });
    expect(r.eligible).toBe(false);
    expect(r.shortfallYears).toBe(7);
    expect(r.costMinor).toBe(toMinor(923 * 5));
  });
});

describe("xb.classify", () => {
  const ieResident = { residence: "IE", nationality: ["IE"] } as const;
  it("treats a UK ISA as taxable for an Irish resident", () => {
    const c = classify({ kind: "isa" }, ieResident, "2026");
    expect(c.taxedBy).toEqual(["IE"]);
    expect(c.flags).toContain("isa-not-exempt");
  });
  it("UK private pension is taxable only in Ireland (Art. 17)", () => {
    const c = classify({ kind: "privatePension", sourceCountry: "UK" }, ieResident, "2026");
    expect(c.reference.ref).toBe("DTA Art. 17");
    expect(c.taxedBy).toEqual(["IE"]);
  });
  it("UK government pension depends on nationality (Art. 18)", () => {
    expect(classify({ kind: "governmentPension", sourceCountry: "UK" }, ieResident, "2026").taxedBy).toEqual(["IE"]);
    expect(classify({ kind: "governmentPension", sourceCountry: "UK" }, { residence: "IE", nationality: ["UK"] }, "2026").taxedBy).toEqual(["UK"]);
  });
  it("frontier worker resident in IE flags trans-border relief and home workdays", () => {
    const c = classify({ kind: "employment", workCountry: "UK", homeWorkdays: 12 }, ieResident, "2026");
    expect(c.flags).toEqual(["trans-border-relief-check", "home-workdays-may-lose-relief"]);
    expect(c.reference.ref).toBe("TCA 1997 s.825A");
  });

  describe("moving to the US", () => {
    const usResident = { residence: "US", nationality: ["IE"], counterpart: "IE" } as const;
    it("Irish and UK private pensions are taxable only in the US", () => {
      const ie = classify({ kind: "privatePension", sourceCountry: "IE" }, usResident, "2026");
      expect(ie.taxedBy).toEqual(["US"]);
      expect(ie.method).toBe("residence-only");
      expect(ie.reference.ref).toBe("IE–US DTA Art. 18(1)(a)");
      const uk = classify({ kind: "privatePension", sourceCountry: "UK" }, { ...usResident, counterpart: "UK" }, "2026");
      expect(uk.taxedBy).toEqual(["US"]);
      expect(uk.flags).toContain("claim-hmrc-relief-at-source");
      expect(uk.notes.join(" ")).toContain("Art. 17(2)");
    });
    it("state pensions follow the social security article", () => {
      expect(classify({ kind: "statePension", sourceCountry: "IE" }, usResident, "2026").reference.ref).toBe("IE–US DTA Art. 18(1)(b)");
      expect(classify({ kind: "statePension", sourceCountry: "UK" }, usResident, "2026").reference.ref).toBe("UK–US DTC Art. 17(3)");
    });
    it("an ISA is taxable in the US and its funds are flagged as PFICs", () => {
      const c = classify({ kind: "isa" }, usResident, "2026");
      expect(c.taxedBy).toEqual(["US"]);
      expect(c.method).toBe("taxable-no-wrapper-exemption");
      expect(c.flags).toEqual(["isa-not-exempt", "check-pfic-funds"]);
    });
    it("keeping an Irish job is taxed in Ireland with a US credit", () => {
      const c = classify({ kind: "employment", workCountry: "IE" }, usResident, "2026");
      expect(c.taxedBy).toEqual(["IE", "US"]);
      expect(c.method).toBe("source-with-credit");
      expect(c.reference.ref).toBe("IE–US DTA Art. 24");
    });
    it("a job in the US is domestic, under the treaty with the country left", () => {
      const c = classify({ kind: "employment", workCountry: "US" }, usResident, "2026");
      expect(c).toMatchObject({ taxedBy: ["US"], method: "domestic" });
      expect(c.reference.ref).toBe("IE–US DTA Art. 15");
    });
    it("interest on an Irish account is taxable in the US and the account is reportable", () => {
      const c = classify({ kind: "deposit", accountCountry: "IE" }, usResident, "2026");
      expect(c.taxedBy).toEqual(["US"]);
      expect(c.notes).toContain("Interest on an Irish account is taxable in US; declare it on your return.");
      expect(c.flags).toEqual(["foreign-deposit-declare", "us-foreign-account-reporting"]);
    });
  });

  describe("US citizens living in Ireland or the UK", () => {
    const american = { residence: "IE", nationality: ["US", "IE"] } as const;
    it("the US taxes their income too (saving clause)", () => {
      const c = classify({ kind: "deposit", accountCountry: "IE" }, american, "2026");
      expect(c.taxedBy).toEqual(["IE", "US"]);
      expect(c.flags).toContain("us-citizen-worldwide");
      expect(c.notes.join(" ")).toContain("IE–US DTA Art. 1(4)");
      expect(classify({ kind: "isa" }, { residence: "UK", nationality: ["US"] }, "2026").taxedBy).toEqual(["US"]);
    });
    it("but not state pensions, which the saving clause leaves out", () => {
      expect(classify({ kind: "statePension", sourceCountry: "UK" }, american, "2026").taxedBy).toEqual(["IE"]);
    });
    it("other nationalities are unchanged", () => {
      expect(classify({ kind: "deposit", accountCountry: "IE" }, ieResident, "2026").taxedBy).toEqual(["IE"]);
    });
  });
});

describe("treaty packs", () => {
  it("has a pack for each pair of countries, every reference sourced", () => {
    for (const [a, b] of [["IE", "UK"], ["IE", "US"], ["UK", "US"]] as const) {
      const t = treatyFor(a, b);
      expect(treatyFor(b, a)).toBe(t);
      for (const r of Object.values(t.articles)) expect(r.source).toMatch(/^https:\/\//);
    }
    for (const a of ["IE", "UK"] as const) {
      const notes = treatyFor(a, "US").relocation?.toUS ?? [];
      expect(notes.length).toBeGreaterThan(0);
      for (const n of notes) expect(n.source).toMatch(/^https:\/\//);
    }
    expect(treaty()).toBe(treatyFor("IE", "UK"));
  });
});
