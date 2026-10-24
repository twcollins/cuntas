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
export * from "./calculators/ie/selfEmployed";
export * from "./calculators/ie/payslip";
export * from "./calculators/uk/studentLoan";
export * from "./calculators/uk/annualAllowance";
export * from "./calculators/uk/payslip";
export * from "./calculators/xb/retirement";
export * from "./calculators/xb/wrappers";

import * as iePayrollMod from "./calculators/ie/payroll";
import * as iePension from "./calculators/ie/pensionRelief";
import * as ieInvest from "./calculators/ie/investmentTax";
import * as ukPayrollMod from "./calculators/uk/payroll";
import * as ukIsa from "./calculators/uk/isa";
import * as ukNi from "./calculators/uk/niVoluntary";
import * as xbMod from "./calculators/xb/classify";
import * as ieSelf from "./calculators/ie/selfEmployed";
import * as iePayslip from "./calculators/ie/payslip";
import * as ukLoan from "./calculators/uk/studentLoan";
import * as ukAa from "./calculators/uk/annualAllowance";
import * as ukPayslip from "./calculators/uk/payslip";
import * as xbRetire from "./calculators/xb/retirement";
import * as xbWrap from "./calculators/xb/wrappers";

/** Namespaced calculators, as named in the spec: ie.payroll, uk.isaAllowance, xb.classify, ... */
export const ie = {
  payroll: iePayrollMod.iePayroll,
  pensionRelief: iePension.pensionReliefHeadroom,
  exitTax: ieInvest.ieExitTax,
  deemedDisposal: ieInvest.ieDeemedDisposals,
  cgt: ieInvest.ieCgt,
  investmentAccount: ieInvest.ieInvestmentAccount,
  helpToBuy: ieInvest.ieHelpToBuy,
  classS: ieSelf.ieClassS,
  selfAssessment: ieSelf.ieSelfAssessment,
  payslipCheck: iePayslip.iePayslipCheck,
  statePension: xbRetire.ieStatePensionEstimate,
};
export const uk = {
  payroll: ukPayrollMod.ukPayroll,
  isaAllowance: ukIsa.ukIsaCheck,
  savingsTax: ukPayrollMod.ukSavingsTax,
  niVoluntary: ukNi.ukNiGapCheck,
  studentLoan: ukLoan.ukStudentLoanRepayment,
  annualAllowance: ukAa.ukAnnualAllowance,
  payslipCheck: ukPayslip.ukPayslipCheck,
  statePension: xbRetire.ukStatePensionEstimate,
};
export const xb = { classify: xbMod.classify, projectRetirement: xbRetire.projectRetirement, compareWrappers: xbWrap.compareWrappers };
