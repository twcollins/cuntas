// Golden tests for US state income tax, 2026. Where a state publishes a worked example that maps
// onto a return, it is reproduced; otherwise the case is worked by hand from the state's published
// rules and says so. Never edit expected values to make a test pass.
import { describe, expect, it } from "vitest";
import { getPack, listStatePacks, toMinor, usPayroll, usStateTax, US_STATE_CODES, type UsState } from "../src";

const pack = (s: UsState) => listStatePacks(s).find((p) => p.taxYear === "2026")!;
const single = (agi: number, federalTaxable = agi - 16100) => ({
  filingStatus: "single" as const,
  federalAgiMinor: toMinor(agi),
  federalTaxableIncomeMinor: toMinor(federalTaxable),
  wagesMinor: toMinor(agi),
  federalStandardDeductionMinor: toMinor(16100),
  filers: 1,
  dependents: 0,
});

describe("golden: Kentucky (2026 withholding formula, monthly example)", () => {
  it("$3,270 a month: (39,240 - 3,360) x 3.5% = 1,255.80 a year", () => {
    expect(usStateTax(pack("KY"), single(39240)).taxMinor).toBe(125580);
  });
});

describe("golden: Illinois (IL-700-T 2026, automated payroll example)", () => {
  it("$800 a week, two exemptions and two $1,000 allowances: $32.13 a week", () => {
    // Two filers aged 65 or over carry the same allowances as the booklet's example.
    const r = usStateTax(pack("IL"), { ...single(41600), filingStatus: "marriedJoint", filers: 2, agedFilers: 2 });
    expect(Math.round(r.taxMinor / 52)).toBe(3213);
  });
  it("no exemption above $250,000 AGI (single)", () => {
    expect(usStateTax(pack("IL"), single(260000)).taxMinor).toBe(Math.round(toMinor(260000) * 0.0495));
  });
});

describe("hand-worked from published rules: Indiana and Iowa", () => {
  it("Indiana, single, AGI 50,000: (50,000 - 1,000) x 2.95% = 1,445.50; county tax noted", () => {
    const r = usStateTax(pack("IN"), single(50000));
    expect(r.taxMinor).toBe(144550);
    expect(r.notes.join(" ")).toMatch(/county income tax/);
  });
  it("Iowa, single, federal taxable income 38,500: 3.8% = 1,463, less the $40 credit = 1,423", () => {
    expect(usStateTax(pack("IA"), single(54600)).taxMinor).toBe(toMinor(1423));
  });
});

describe("hand-worked from published rules: Louisiana, Michigan, Mississippi, North Carolina", () => {
  it("Louisiana, single, AGI 50,000: (50,000 - 12,838) x 3% = 1,114.86", () => {
    expect(usStateTax(pack("LA"), single(50000)).taxMinor).toBe(111486);
  });
  it("Michigan, single, AGI 50,000: (50,000 - 5,900) x 4.25% = 1,874.25; city tax noted", () => {
    const r = usStateTax(pack("MI"), single(50000));
    expect(r.taxMinor).toBe(187425);
    expect(r.notes.join(" ")).toMatch(/Detroit/);
  });
  it("Mississippi, single, AGI 50,000: 50,000 - 2,300 - 6,000 = 41,700; 4% of the 31,700 over 10,000 = 1,268", () => {
    expect(usStateTax(pack("MS"), single(50000)).taxMinor).toBe(toMinor(1268));
  });
  it("Mississippi, head of household with one child: the 8,000 exemption plus 1,500", () => {
    const r = usStateTax(pack("MS"), { ...single(50000), filingStatus: "headOfHousehold", dependents: 1 });
    // 50,000 - 3,400 - 8,000 - 1,500 = 37,100; 4% of 27,100.
    expect(r.taxMinor).toBe(toMinor(1084));
  });
  it("North Carolina, single, AGI 50,000: (50,000 - 12,750) x 3.99% = 1,486.28", () => {
    expect(usStateTax(pack("NC"), single(50000)).taxMinor).toBe(148628);
  });
  it("North Carolina, joint, AGI 50,000, two children: 2,500 child deduction each in the 40,001-60,000 band", () => {
    const r = usStateTax(pack("NC"), { ...single(50000), filingStatus: "marriedJoint", filers: 2, dependents: 2 });
    // (50,000 - 25,500 - 5,000) x 3.99% = 778.05
    expect(r.taxMinor).toBe(77805);
  });
});

describe("golden: Georgia (2026 employer's guide, example 1)", () => {
  it("married, spouse not working, $2,000 semi-monthly, one child: $27.03 a pay", () => {
    // (48,000 - 30,000 - 5,000) x 4.99% = 648.70 a year.
    const r = usStateTax(pack("GA"), { ...single(48000), filingStatus: "marriedJoint", filers: 2, dependents: 1 });
    expect(r.taxMinor).toBe(64870);
    expect(Math.round(r.taxMinor / 24)).toBe(2703);
  });
});

describe("golden: Colorado (tax table, same 4.40% rate)", () => {
  it("taxable income $30,000-30,100: $1,322", () => {
    // The table taxes the bracket's midpoint, 30,050.
    expect(Math.round(usStateTax(pack("CO"), single(46150, 30050)).taxMinor / 100)).toBe(1322);
  });
});

describe("hand-worked from published rules: Idaho and Arizona", () => {
  it("Idaho, single, AGI 60,000: (60,000 - 16,100 - 4,811) x 5.3% = 2,071.72", () => {
    expect(usStateTax(pack("ID"), single(60000)).taxMinor).toBe(207172);
  });
  it("Arizona, single, AGI 60,000: (60,000 - 16,100) x 2.5% = 1,097.50; less $125 per child", () => {
    expect(usStateTax(pack("AZ"), single(60000)).taxMinor).toBe(109750);
    expect(usStateTax(pack("AZ"), { ...single(60000), filingStatus: "headOfHousehold", dependents: 2 }).taxMinor).toBe(109750 - 25000);
  });
});

describe("golden: Virginia (2026 withholding guide, 2025 Form 760 instructions and tax table)", () => {
  const va = () => pack("VA");
  it("withholding example: $2,649 semi-monthly, 5 exemptions: (63,576 - 8,750 - 4,650) -> $2,628 a year", () => {
    const r = usStateTax(va(), { ...single(63576), filingStatus: "headOfHousehold", dependents: 4 });
    expect(r.taxableMinor).toBe(toMinor(50176));
    expect(Math.round(r.taxMinor / 100)).toBe(2628);
  });
  it("rate schedule: taxable income $90,000 -> $720 + $4,197.50 = $4,917.50", () => {
    const r = usStateTax(va(), single(99680));
    expect(r.taxableMinor).toBe(toMinor(90000));
    expect(r.taxMinor).toBe(491750);
  });
  it("tax table: $25,000-25,035 -> $1,181 (taxed at the midpoint)", () => {
    expect(Math.round(usStateTax(va(), single(34697.5)).taxMinor / 100)).toBe(1181);
  });
  it("spouse tax adjustment example: joint taxable $47,000 split 35,000 / 12,000: 2,445 - 220 = 2,225", () => {
    const r = usStateTax(va(), { ...single(66360), filingStatus: "marriedJoint", filers: 2, filerAgiMinor: [toMinor(53430), toMinor(12930)] });
    expect(r.taxableMinor).toBe(toMinor(47000));
    expect(r.taxMinor).toBe(toMinor(2225));
  });
  it("age deduction (hand-worked): single, 70, AGI 60,000: 12,000 - 10,000 = 2,000; tax 2,474.90", () => {
    const r = usStateTax(va(), { ...single(60000), agedFilers: 1 });
    expect(r.taxMinor).toBe(247490);
  });
  it("filing threshold: no tax below $11,950 single", () => {
    expect(usStateTax(va(), single(11000)).taxMinor).toBe(0);
  });
  it("low-income credit: $300 a person within the poverty guideline", () => {
    const r = usStateTax(va(), single(15000));
    expect(r.taxMinor).toBe(0);
    expect(r.lines.some((l) => l.label === "Virginia credit for low-income individuals")).toBe(true);
  });
});

describe("golden: Indiana (2025 IT-40 booklet, Jacob and Becca; county from DN#1)", () => {
  const ind = () => pack("IN");
  it("joint wages and interest 44,080, $3,000 rent, two exemptions: line 7 = 39,080", () => {
    const r = usStateTax(ind(), { ...single(44080), filingStatus: "marriedJoint", filers: 2, rentPaidMinor: toMinor(3000), locality: "marion" });
    expect(r.taxableMinor).toBe(toMinor(39080));
    expect(r.taxMinor).toBe(115286);
    // Marion County 2.02% on the same income.
    expect(r.localTaxMinor).toBe(78942);
    expect(r.notes.join(" ")).not.toMatch(/Choose your county/);
  });
  it("hand-worked: single, 70, AGI 30,000: $1,000 + $1,000 + $500 low-income 65+ exemptions -> 811.25", () => {
    expect(usStateTax(ind(), { ...single(30000), agedFilers: 1 }).taxMinor).toBe(81125);
  });
  it("carries all 92 counties", () => {
    const l = ind().localities!;
    expect(l.list).toHaveLength(92);
    expect(l.list.find((c) => c.id === "stjoseph")).toMatchObject({ name: "St. Joseph", rate: 0.0175 });
  });
});

describe("golden: Maine (2026 rate schedule; 2026 withholding booklet examples)", () => {
  it("single, taxable 28,550: $1,589 + 6.75% of 1,150 -> $1,667", () => {
    const r = usStateTax(pack("ME"), single(49550));
    expect(r.taxableMinor).toBe(toMinor(28550));
    expect(Math.round(r.taxMinor / 100)).toBe(1667);
  });
  it("hand-worked: joint, AGI 234,000: the standard deduction keeps 1 - 29,450 / 150,000 of 31,400", () => {
    const r = usStateTax(pack("ME"), { ...single(234000), filingStatus: "marriedJoint", filers: 2 });
    // 31,400 x 0.803667 = 25,235.13; taxable 234,000 - 25,235.13 - 10,600 = 198,164.87.
    expect(r.taxableMinor / 100).toBeCloseTo(198164.87, 0);
    expect(r.taxMinor / 100).toBeCloseTo(3181.3 + 5055.75 + 0.0715 * 68414.87, 0);
  });
  it("the dependent credit falls $20 per $500 over the threshold", () => {
    const at = (agi: number) => usStateTax(pack("ME"), { ...single(agi), dependents: 1 }).taxMinor - usStateTax(pack("ME"), single(agi)).taxMinor;
    expect(at(90000)).toBe(-toMinor(300));
    expect(at(101000)).toBe(-toMinor(260));
  });
});

describe("golden: Maryland (2025 tax table and rate schedule; rates unchanged for 2026)", () => {
  const md = () => pack("MD");
  it("taxable $50,000-50,050 -> $2,324 and $75,000-75,050 -> $3,511 (at the midpoint)", () => {
    expect(Math.round(usStateTax(md(), single(50025 + 6600)).taxMinor / 100)).toBe(2324);
    expect(Math.round(usStateTax(md(), single(75025 + 6600)).taxMinor / 100)).toBe(3511);
  });
  it("rate schedule: $100,000 single -> $4,697.50; $150,000 joint -> $7,072.50", () => {
    // Above $100,000 single the exemption steps down to $1,600.
    expect(usStateTax(md(), single(100000 + 3400 + 1600)).taxMinor).toBe(469750);
    // Joint AGI between $150,000 and $175,000: $1,600 per exemption.
    expect(usStateTax(md(), { ...single(150000 + 6700 + 3200), filingStatus: "marriedJoint", filers: 2 }).taxMinor).toBe(707250);
  });
  it("the two-income subtraction takes the lower earner's income up to $1,200", () => {
    const joint = { ...single(80000), filingStatus: "marriedJoint" as const, filers: 2 };
    const one = usStateTax(md(), joint).taxMinor;
    const two = usStateTax(md(), { ...joint, filerAgiMinor: [toMinor(60000), toMinor(20000)] }).taxMinor;
    expect(one - two).toBe(Math.round(toMinor(1200) * 0.0475));
  });
});

describe("golden: Delaware (Employer's Guide examples, which compute the annual tax)", () => {
  it("single, $25,000: 21,750 taxable -> $832 - $110 = $722", () => {
    expect(usStateTax(pack("DE"), single(25000)).taxMinor).toBe(toMinor(722));
  });
  it("joint, $25,000, one dependent: 18,500 -> $669 - $330 = $339", () => {
    expect(usStateTax(pack("DE"), { ...single(25000), filingStatus: "marriedJoint", filers: 2, dependents: 1 }).taxMinor).toBe(toMinor(339));
  });
});

describe("golden: District of Columbia (2025 tax table; rates unchanged)", () => {
  it("taxable $50,000-50,049 -> $2,852 (at the midpoint)", () => {
    expect(Math.round(usStateTax(pack("DC"), single(50024.5 + 15000)).taxMinor / 100)).toBe(2852);
  });
});

describe("hand-worked: West Virginia (2026 rates after SB 392)", () => {
  it("single, AGI 50,000: 48,000 taxable -> $1,106.50 + 4.22% of 8,000 = $1,444.10", () => {
    expect(usStateTax(pack("WV"), single(50000)).taxMinor).toBe(144410);
  });
  it("no tax at AGI under $10,000", () => {
    expect(usStateTax(pack("WV"), single(9000)).taxMinor).toBe(0);
  });
});

describe("states with no income tax on wages (official statements)", () => {
  for (const s of ["AK", "FL", "NV", "NH", "SD", "TN", "TX", "WA", "WY"] as const) {
    it(`${s}: no tax on $60,000 of wages`, () => {
      const r = usStateTax(pack(s), single(60000));
      expect(r.taxMinor).toBe(0);
      expect(r.notes[0]).toMatch(/has no income tax on wages/);
    });
  }
  it("Washington says what it does tax", () => {
    expect(usStateTax(pack("WA"), single(60000)).notes.join(" ")).toMatch(/capital gains[\s\S]*2028/);
  });
});

describe("hand-worked from published rules: Pennsylvania, Massachusetts, Utah", () => {
  it("Pennsylvania taxes compensation before 401(k) deferrals: 3.07% of 60,000 = 1,842", () => {
    const r = usPayroll(getPack("US", "2026"), { employment: "employee", filingStatus: "single", age: 35, grossAnnualMinor: toMinor(60000), pretax401kMinor: toMinor(6000), state: pack("PA") });
    expect(r.stateTaxMinor).toBe(toMinor(1842));
    expect(r.notes.join(" ")).toMatch(/earned income tax/);
  });
  it("Massachusetts, single, wages 60,000: less 4,400 and 2,000 of FICA = 53,600 x 5% = 2,680", () => {
    const r = usStateTax(pack("MA"), { ...single(60000), payrollTaxByFilerMinor: [toMinor(4590)] });
    expect(r.taxMinor).toBe(toMinor(2680));
  });
  it("Massachusetts surtax: 4% more on taxable income over 1,107,750", () => {
    const r = usStateTax(pack("MA"), { ...single(1504400), payrollTaxByFilerMinor: [toMinor(2000)] });
    // Taxable 1,498,000: 5% of 1,107,750 + 9% of 390,250.
    expect(r.taxMinor).toBe(toMinor(55387.5 + 35122.5));
  });
  it("Utah, single, AGI 60,000: 2,670 less the taxpayer credit (966 - 1.3% of 41,304) = 2,240.95", () => {
    expect(usStateTax(pack("UT"), single(60000)).taxMinor).toBe(224095);
  });
  it("Utah's credit is gone by about 93,000 single", () => {
    expect(usStateTax(pack("UT"), single(100000)).taxMinor).toBe(toMinor(4450));
  });
});

describe("golden: batch 2, published examples", () => {
  const joint = (agi: number, extra: object = {}) => ({ ...single(agi), filingStatus: "marriedJoint" as const, filers: 2, federalStandardDeductionMinor: toMinor(32200), ...extra });
  it("California 2025 rate schedule: joint taxable $125,000 -> $4,768.10, less two $153 credits", () => {
    const r = usStateTax(pack("CA"), joint(125000 + 11412));
    expect(r.taxableMinor).toBe(toMinor(125000));
    expect(r.taxMinor).toBe(476810 - 30600);
  });
  it("California 2025 tax table: single $50,051-50,150 -> $1,541 before the $153 credit", () => {
    expect(Math.round((usStateTax(pack("CA"), single(50100.5 + 5706)).taxMinor + 15300) / 100)).toBe(1541);
  });
  it("Oregon 2026 example 3: joint, $8,750 federal tax deducted, taxable $68,000 -> $5,312; less 5 x $260", () => {
    const r = usStateTax(pack("OR"), joint(82550, { wagesMinor: 0, dependents: 3, federalIncomeTaxMinor: toMinor(9000) }));
    expect(r.taxableMinor).toBe(toMinor(68000));
    expect(r.taxMinor).toBe(toMinor(5312 - 1300));
  });
  it("Oregon's transit tax is 0.1% of wages", () => {
    expect(usStateTax(pack("OR"), single(60000)).levyMinor).toBe(toMinor(60));
  });
  it("Hawaii tax table $23,250-23,300: joint $399, single $813, head of household $524", () => {
    const at = (status: "single" | "marriedJoint" | "headOfHousehold", deduction: number, filers: number) =>
      Math.round(usStateTax(pack("HI"), { ...single(23275 + deduction + 1144 * filers), filingStatus: status, filers }).taxMinor / 100);
    expect(at("marriedJoint", 16000, 2)).toBe(399);
    expect(at("single", 8000, 1)).toBe(813);
    expect(at("headOfHousehold", 12000, 1)).toBe(524);
  });
  it("Montana 2026 withholding: single, $1,375 semi-monthly -> $33 a pay", () => {
    expect(Math.round(usStateTax(pack("MT"), single(33000)).taxMinor / 2400)).toBe(33);
  });
  it("New Mexico rate table: joint $25,300-25,400 -> $679", () => {
    expect(Math.round(usStateTax(pack("NM"), joint(25350 + 32200)).taxMinor / 100)).toBe(679);
  });
  it("New Jersey tax table: Evans, joint taxable $39,875 -> $628", () => {
    expect(Math.round(usStateTax(pack("NJ"), joint(39875 + 2000)).taxMinor / 100)).toBe(628);
  });
  it("Connecticut Table B: single line 3 = $13,000 -> $335, then the .15 personal credit", () => {
    const r = usStateTax(pack("CT"), single(28000));
    expect(r.taxableMinor).toBe(toMinor(13000));
    expect(r.taxMinor).toBe(28475);
  });
  it("Minnesota 2026 tax table: single $30,000-30,100 -> $1,608; joint $50,000-50,100 -> $2,697", () => {
    expect(Math.round(usStateTax(pack("MN"), single(30050 + 15300)).taxMinor / 100)).toBe(1608);
    expect(Math.round(usStateTax(pack("MN"), joint(50050 + 30600)).taxMinor / 100)).toBe(2697);
  });
  it("Missouri 2026 withholding: $35,000 - $16,100 = 18,900 -> $707.81; estimated tax chart: $4,000 -> $59.60", () => {
    expect(usStateTax(pack("MO"), single(35000)).taxMinor).toBe(70781);
    expect(usStateTax(pack("MO"), single(20100)).taxMinor).toBe(5960);
  });
  it("Arkansas 2026 withholding: $25,524 a year -> $496 less two $29 credits = $438", () => {
    expect(Math.round(usStateTax(pack("AR"), { ...single(25520), dependents: 1 }).taxMinor / 100)).toBe(438);
  });
  it("Alabama 2026 withholding: joint, $44,200, federal tax $1,830, two dependents -> $1,538.50", () => {
    expect(usStateTax(pack("AL"), joint(44200, { dependents: 2, federalIncomeTaxMinor: toMinor(1830) })).taxMinor).toBe(153850);
  });
});

describe("hand-worked from published rules: batch 2", () => {
  it("New York, single, taxable $50,000: $586 + 5.40% of 36,100 = $2,535.40", () => {
    expect(usStateTax(pack("NY"), single(58000)).taxMinor).toBe(253540);
  });
  it("New York supplemental tax: single, AGI $130,000, taxable $122,000 -> $6,884.10 (statute constants)", () => {
    const r = usStateTax(pack("NY"), single(130000));
    expect(r.taxableMinor).toBe(toMinor(122000));
    expect(r.taxMinor).toBe(688410);
  });
  it("Connecticut, single, AGI $60,000: (2,550 + 25) x 0.90 = $2,317.50", () => {
    expect(usStateTax(pack("CT"), single(60000)).taxMinor).toBe(231750);
  });
  it("Rhode Island, taxable $100,000: $3,076.88 + 4.75% of 17,950 = $3,929.51", () => {
    expect(usStateTax(pack("RI"), single(100000 + 11200 + 5250)).taxMinor).toBe(392951);
  });
  it("Vermont, single, taxable $60,000: $1,700 + 6.6% of 9,250 = $2,310.50", () => {
    expect(usStateTax(pack("VT"), single(60000 + 7650 + 5300)).taxMinor).toBe(231050);
  });
  it("Ohio, single, AGI $70,200: taxable 68,050 -> $332 + 2.75% of 42,000 = $1,487; nothing at $26,050 or less", () => {
    expect(usStateTax(pack("OH"), single(70200)).taxMinor).toBe(toMinor(1487));
    expect(usStateTax(pack("OH"), single(28000)).taxMinor).toBe(0);
  });
  it("Wisconsin, single, $50,000: sliding deduction 10,374.40 and $700 -> $1,576.74", () => {
    expect(usStateTax(pack("WI"), single(50000)).taxMinor / 100).toBeCloseTo(1576.74, 1);
  });
  it("North Dakota, single, federal taxable $60,000: 1.95% of 10,425 = $203.29", () => {
    expect(usStateTax(pack("ND"), single(76100, 60000)).taxMinor).toBe(20329);
  });
  it("Nebraska, single, AGI $60,000: $2,026.46 less the $176 credit = $1,850.46", () => {
    expect(usStateTax(pack("NE"), single(60000)).taxMinor).toBe(185046);
  });
  it("Kansas, single, taxable $50,000: $1,196 + 5.58% of 27,000 = $2,702.60", () => {
    expect(usStateTax(pack("KS"), single(50000 + 3605 + 9160)).taxMinor).toBe(270260);
  });
  it("Oklahoma, single, taxable $50,000: $28.75 + $80.50 + 4.5% of 42,800 = $2,035.25", () => {
    expect(usStateTax(pack("OK"), single(50000 + 6350 + 1000)).taxMinor).toBe(203525);
  });
  it("South Carolina, single, AGI $60,000: SCIAD about 9,550 -> about $1,662", () => {
    expect(usStateTax(pack("SC"), single(60000)).taxMinor / 100).toBeCloseTo(1662.45, -1);
  });
  it("Minnesota's refundable child credit can take state tax below zero", () => {
    const r = usStateTax(pack("MN"), { ...single(20000), filingStatus: "headOfHousehold", dependents: 2 });
    expect(r.taxMinor).toBeLessThan(0);
  });
});

describe("all 50 states and D.C.", () => {
  it("every state has a 2026 pack", () => {
    expect(US_STATE_CODES.filter((s) => !listStatePacks(s).some((p) => p.taxYear === "2026"))).toEqual([]);
  });
});

describe("every state pack", () => {
  it("is for a real state, sourced, and computes", () => {
    for (const p of listStatePacks()) {
      expect(US_STATE_CODES).toContain(p.state);
      expect(p.incomeTax.source).toMatch(/^https:\/\//);
      expect(() => usStateTax(p, single(60000))).not.toThrow();
    }
  });
  it("feeds take-home: Kentucky on $60,000 single", () => {
    const r = usPayroll(getPack("US", "2026"), { employment: "employee", filingStatus: "single", age: 35, grossAnnualMinor: toMinor(60000), state: pack("KY") });
    expect(r.stateTaxMinor).toBe(Math.round((toMinor(60000) - toMinor(3360)) * 0.035));
  });
});
