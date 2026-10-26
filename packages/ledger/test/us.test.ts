import { describe, expect, it } from "vitest";
import { getPack, toMinor } from "@cuntas/rules";
import { evaluateUs } from "@cuntas/engine";
import { buildSnapshot, createDemoDataset, createEmptyDataset, datasetSchema, memberPay, newMember, planFor, retirementPlan, type Dataset } from "../src";

const asOf = "2026-10-22";

/** A US household: members resident in the US all year, pay in dollars. */
function usHousehold(members: Parameters<typeof newMember>[0][]): Dataset {
  const ds = createEmptyDataset("US", "USD", `${asOf}T00:00:00Z`);
  ds.members = members.map((m) => newMember({ nationality: ["US"], ...m }));
  ds.residencePeriods = ds.members.map((m) => ({ id: `rp_${m.id}`, memberId: m.id, jurisdiction: "US", from: "2020-01-01", to: null, declaredBy: "user" }));
  return ds;
}

describe("US take-home in the household", () => {
  it("a single employee earning USD 60,000 takes home 50,390 under the 2026 federal pack", () => {
    const ds = usHousehold([{ id: "m1", name: "Alex", dateOfBirth: "1990-05-01", grossAnnualMinor: toMinor(60000) }]);
    const pay = memberPay(ds, ds.members[0]!, asOf);
    expect(pay).toMatchObject({ netAnnualMinor: toMinor(50390), currency: "USD", pack: "US-2026.1" });
    expect(pay.marginalRate).toBeCloseTo(0.1965, 6);
  });

  it("married filing jointly shares the joint return and claims the household's children", () => {
    const ds = usHousehold([
      { id: "m1", name: "Alex", dateOfBirth: "1990-05-01", grossAnnualMinor: toMinor(150000), usFilingStatus: "marriedJoint" },
      { id: "m2", name: "Sam", dateOfBirth: "1991-02-01", employmentType: "notWorking", usFilingStatus: "marriedJoint" },
    ]);
    ds.household.settings.children = 2;
    // Golden: joint tax 15,340 less 4,400 child tax credit = 10,940; FICA 9,300 + 2,175.
    expect(memberPay(ds, ds.members[0]!, asOf).netAnnualMinor).toBe(toMinor(150000 - 10940 - 9300 - 2175));
    expect(memberPay(ds, ds.members[1]!, asOf).netAnnualMinor).toBe(0);
  });

  it("a US workplace plan's employee rate is a pre-tax 401(k) deferral", () => {
    const ds = usHousehold([{ id: "m1", name: "Alex", dateOfBirth: "1990-05-01", grossAnnualMinor: toMinor(60000) }]);
    ds.pensionPlans = [{ id: "pp1", memberId: "m1", name: "401(k)", kind: "us401k", jurisdiction: "US", currency: "USD", valueMinor: 0, employeeRate: 0.1, employerRate: 0.04, employerMatchRule: null, isEmployerScheme: true }];
    // Golden: 6,000 deferred, income tax 4,300, FICA unchanged.
    expect(memberPay(ds, ds.members[0]!, asOf).netAnnualMinor).toBe(toMinor(60000 - 6000 - 4300 - 3720 - 870));
  });

  it("the snapshot and retirement plan work for a US household", () => {
    const ds = usHousehold([{ id: "m1", name: "Alex", dateOfBirth: "1990-05-01", grossAnnualMinor: toMinor(60000) }]);
    const snap = buildSnapshot(ds, asOf);
    expect(snap.members[0]).toMatchObject({ residence: "US", netMonthlyMinor: Math.round(toMinor(50390) / 12) });
    expect(() => retirementPlan(ds, asOf)).not.toThrow();
  });

  it("members saved before filing status existed load as single", () => {
    const ds = usHousehold([{ id: "m1", name: "Alex", dateOfBirth: "1990-05-01" }]);
    const raw = JSON.parse(JSON.stringify(ds)) as { members: Record<string, unknown>[] };
    delete raw.members[0]!.usFilingStatus;
    expect(datasetSchema.parse(raw).members[0]!.usFilingStatus).toBe("single");
  });
});

describe("US plan in the snapshot", () => {
  it("the US ladder runs only when everyone lives in the US", () => {
    const us = usHousehold([{ id: "m1", name: "Alex", dateOfBirth: "1990-05-01", grossAnnualMinor: toMinor(60000) }]);
    expect(planFor(us, asOf)).toBe("US");
    expect(buildSnapshot(us, asOf).thresholds.starterFundFloorMinor).toBe(toMinor(1000));
    expect(planFor(createDemoDataset(asOf), asOf)).toBe("IE");
  });

  it("carries each US member's dollar figures for the limits", () => {
    const ds = usHousehold([{ id: "m1", name: "Alex", dateOfBirth: "1990-05-01", grossAnnualMinor: toMinor(60000), usHsaCoverage: "selfOnly" }]);
    ds.pensionPlans = [
      { id: "k", memberId: "m1", name: "401(k)", kind: "us401k", jurisdiction: "US", currency: "USD", valueMinor: 0, employeeRate: 0.1, employerRate: 0.05, employerMatchRule: { upToRate: 0.05, ratio: 1 }, isEmployerScheme: true },
      { id: "r", memberId: "m1", name: "Roth IRA", kind: "usRothIRA", jurisdiction: "US", currency: "USD", valueMinor: 0, employeeRate: 0, employerRate: 0, employerMatchRule: null, isEmployerScheme: false },
    ];
    ds.contributions = [
      { id: "c1", pensionPlanId: "r", date: "2026-03-01", employeeMinor: toMinor(3000), employerMinor: 0 },
      { id: "c2", pensionPlanId: "r", date: "2025-12-01", employeeMinor: toMinor(9999), employerMinor: 0 },
    ] as Dataset["contributions"];
    const m = buildSnapshot(ds, asOf).members[0]!;
    expect(m.us).toMatchObject({ coveredByWorkplacePlan: true, employeeDeferralMinor: toMinor(6000), magiMinor: toMinor(54000), iraContribYtdMinor: toMinor(3000), hsaCoverage: "selfOnly" });
  });

  it("a US household gets US next steps, in dollars", () => {
    const ds = usHousehold([{ id: "m1", name: "Alex", dateOfBirth: "1990-05-01", grossAnnualMinor: toMinor(60000) }]);
    const r = evaluateUs(buildSnapshot(ds, asOf), getPack("US", "2026"));
    expect(r.current?.check).toBe("us.budget.tracking");
    expect(r.ladder[0]!.step).toBe("us.budget");
  });

  it("a self-employed US member sets aside estimated tax, due on the next quarterly date", () => {
    const ds = usHousehold([{ id: "m1", name: "Alex", dateOfBirth: "1990-05-01", grossAnnualMinor: toMinor(80000), employmentType: "selfEmployed" }]);
    const t = buildSnapshot(ds, asOf).selfEmployedTax!;
    // Golden self-employed case: 11,303.64 + 5,343.82 a year.
    expect(t.monthlySetAsideMinor).toBe(Math.ceil((1130364 + 534382) / 12));
    expect(t.nextDeadline).toBe("2027-01-15");
  });
});


describe("state income tax in the household", () => {
  it("a member with no state chosen is federal only; choosing a state with a pack adds its tax", () => {
    const ds = usHousehold([{ id: "m1", name: "Alex", dateOfBirth: "1990-05-01", grossAnnualMinor: toMinor(60000) }]);
    const federal = memberPay(ds, ds.members[0]!, asOf).netAnnualMinor;
    expect(federal).toBe(toMinor(50390));
    ds.members[0]!.usState = "TX";
    expect(memberPay(ds, ds.members[0]!, asOf).netAnnualMinor).toBe(federal);
  });
  it("old members load with no state", () => {
    const ds = usHousehold([{ id: "m1", name: "Alex", dateOfBirth: "1990-05-01" }]);
    const raw = JSON.parse(JSON.stringify(ds)) as { members: Record<string, unknown>[] };
    delete raw.members[0]!.usState;
    expect(datasetSchema.parse(raw).members[0]!.usState).toBeNull();
  });
});

describe("a new household with its first person", () => {
  it("starts with that person resident where the household lives", () => {
    const ds = createEmptyDataset("The Lees", "USD", `${asOf}T00:00:00Z`, { name: "Alex", home: "US" });
    expect(datasetSchema.parse(ds)).toBeTruthy();
    expect(ds.members.map((m) => m.name)).toEqual(["Alex"]);
    expect(ds.members[0]!.nationality).toEqual(["US"]);
    expect(ds.residencePeriods).toMatchObject([{ memberId: ds.members[0]!.id, jurisdiction: "US", to: null }]);
    expect(planFor(ds, asOf)).toBe("US");
  });
  it("starts empty when no first person is given", () => {
    expect(createEmptyDataset("Test", "EUR").members).toEqual([]);
  });
});
