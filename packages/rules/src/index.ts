export * from "./money";
export * from "./dates";
export * from "./packs";
export * from "./calculators/shared";
export * from "./calculators/ie/payroll";
export * from "./calculators/ie/pensionRelief";
export * from "./calculators/ie/myFutureFund";
export * from "./calculators/ie/investmentTax";
export * from "./calculators/uk/payroll";
export * from "./calculators/uk/isa";
export * from "./calculators/uk/niVoluntary";
export * from "./calculators/xb/classify";

import * as iePayrollMod from "./calculators/ie/payroll";
import * as iePension from "./calculators/ie/pensionRelief";
import * as ieInvest from "./calculators/ie/investmentTax";
import * as ukPayrollMod from "./calculators/uk/payroll";
import * as ukIsa from "./calculators/uk/isa";
import * as ukNi from "./calculators/uk/niVoluntary";
import * as xbMod from "./calculators/xb/classify";

/** Namespaced calculators, as named in the spec: ie.payroll, uk.isaAllowance, xb.classify, ... */
export const ie = {
  payroll: iePayrollMod.iePayroll,
  pensionRelief: iePension.pensionReliefHeadroom,
  exitTax: ieInvest.ieExitTax,
  deemedDisposal: ieInvest.ieDeemedDisposals,
  cgt: ieInvest.ieCgt,
  investmentAccount: ieInvest.ieInvestmentAccount,
  helpToBuy: ieInvest.ieHelpToBuy,
};
export const uk = {
  payroll: ukPayrollMod.ukPayroll,
  isaAllowance: ukIsa.ukIsaCheck,
  savingsTax: ukPayrollMod.ukSavingsTax,
  niVoluntary: ukNi.ukNiGapCheck,
};
export const xb = { classify: xbMod.classify };
