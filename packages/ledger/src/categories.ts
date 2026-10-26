import type { Category, CategoryRule, Transaction } from "./schema";
import { newId } from "./ids";

type C = Omit<Category, "kind" | "waterfall"> & Partial<Pick<Category, "kind" | "waterfall">>;
const c = (x: C): Category => ({ kind: "expense", waterfall: null, ...x });

/** Default categories, grouped in the flowchart's payday order. */
export const DEFAULT_CATEGORIES: Category[] = [
  c({ id: "cat_rent", name: "Rent or mortgage", group: "Housing", isEssential: true, waterfall: "housing" }),
  c({ id: "cat_home_insurance", name: "Home insurance", group: "Housing", isEssential: true, waterfall: "housing" }),
  c({ id: "cat_lpt", name: "Property tax / council tax", group: "Housing", isEssential: true, waterfall: "housing" }),
  c({ id: "cat_groceries", name: "Groceries", group: "Food", isEssential: true, waterfall: "food" }),
  c({ id: "cat_energy", name: "Energy", group: "Essential bills", isEssential: true, waterfall: "essentialBills" }),
  c({ id: "cat_water_bins", name: "Water and bins", group: "Essential bills", isEssential: true, waterfall: "essentialBills" }),
  c({ id: "cat_toiletries", name: "Toiletries and pharmacy", group: "Essential bills", isEssential: true, waterfall: "essentialBills" }),
  c({ id: "cat_health_insurance", name: "Health insurance", group: "Essential bills", isEssential: true, waterfall: "essentialBills" }),
  c({ id: "cat_childcare", name: "Childcare", group: "Essential bills", isEssential: true, waterfall: "essentialBills" }),
  c({ id: "cat_commute", name: "Commute and fuel", group: "Income-earning costs", isEssential: true, waterfall: "incomeCosts" }),
  c({ id: "cat_car", name: "Car (motor tax, NCT, insurance)", group: "Income-earning costs", isEssential: true, waterfall: "incomeCosts" }),
  c({ id: "cat_phone_internet", name: "Phone and internet", group: "Income-earning costs", isEssential: true, waterfall: "incomeCosts" }),
  c({ id: "cat_debt_payments", name: "Debt repayments", group: "Debt", isEssential: true, waterfall: "minimumDebt" }),
  c({ id: "cat_savings", name: "Savings", group: "Savings", isEssential: false, kind: "transfer", waterfall: "emergencyFund" }),
  c({ id: "cat_tv_subs", name: "TV and subscriptions", group: "Non-essential bills", isEssential: false, waterfall: "nonEssentialBills" }),
  c({ id: "cat_eating_out", name: "Eating out and takeaway", group: "Lifestyle", isEssential: false }),
  c({ id: "cat_shopping", name: "Shopping", group: "Lifestyle", isEssential: false }),
  c({ id: "cat_entertainment", name: "Entertainment", group: "Lifestyle", isEssential: false }),
  c({ id: "cat_travel", name: "Holidays and travel", group: "Lifestyle", isEssential: false }),
  c({ id: "cat_gifts", name: "Gifts and donations", group: "Lifestyle", isEssential: false }),
  c({ id: "cat_fees", name: "Bank fees and charges", group: "Other", isEssential: false }),
  c({ id: "cat_other", name: "Other", group: "Other", isEssential: false }),
  c({ id: "cat_salary", name: "Salary", group: "Income", isEssential: false, kind: "income" }),
  c({ id: "cat_other_income", name: "Other income", group: "Income", isEssential: false, kind: "income" }),
  c({ id: "cat_transfer", name: "Transfer", group: "Transfers", isEssential: false, kind: "transfer" }),
];

/** Irish and UK merchant dictionary. Checked after the user's own rules. */
export const MERCHANT_DICTIONARY: { pattern: RegExp; categoryId: string }[] = [
  { pattern: /tesco|dunnes|supervalu|super valu|lidl|aldi|spar\b|centra|londis|mace\b|sainsbury|asda|morrisons|waitrose|co-?op food|m&s food|iceland/i, categoryId: "cat_groceries" },
  { pattern: /electric ireland|bord g[aá]is|sse airtricity|energia|flogas|panda power|pinergy|community power|yuno|octopus energy|british gas|edf energy|e\.?on|power ni|budget energy/i, categoryId: "cat_energy" },
  { pattern: /uisce [eé]ireann|irish water|panda waste|greyhound|city bin|thames water|nw water/i, categoryId: "cat_water_bins" },
  { pattern: /boots|pharmacy|chemist|hickey'?s|lloyds pharmacy|superdrug/i, categoryId: "cat_toiletries" },
  { pattern: /\bvhi\b|laya|irish life health|level health|bupa|axa health/i, categoryId: "cat_health_insurance" },
  { pattern: /leap card|\btfi\b|irish rail|iarnr[oó]d|dublin bus|bus [eé]ireann|luas|go-?ahead|translink|\btfl\b|trainline|circle k|applegreen|maxol|texaco|topaz|\bemo\b|\bshell\b|\bbp\b|\besso\b|parking|eflow|m50/i, categoryId: "cat_commute" },
  { pattern: /motor tax|\bnct\b|aviva|axa|allianz|liberty insurance|fbd|zurich|an post insurance|chill insurance|123\.ie|dvla|\bmot\b/i, categoryId: "cat_car" },
  { pattern: /\beir\b|vodafone|three\.ie|\bthree\b|virgin media|sky\b|\bbt\b|bt group|48\.ie|gomo|tesco mobile|giffgaff|\bee\b|o2|pure telecom|digiweb/i, categoryId: "cat_phone_internet" },
  { pattern: /netflix|spotify|disney\+?|amazon prime|apple\.com|icloud|youtube premium|now tv|tv licen[cs]e|xbox|playstation|audible/i, categoryId: "cat_tv_subs" },
  { pattern: /deliveroo|just ?eat|uber ?eats|insomnia|starbucks|costa|pret|butlers|supermac|mcdonald|eddie rocket|nando|subway|burger king|domino|apache pizza|wetherspoon|\bpub\b|bar\b|restaurant|caf[eé]/i, categoryId: "cat_eating_out" },
  { pattern: /penneys|primark|zara|h&m|next\b|tk ?maxx|amazon|argos|harvey norman|currys|ikea|smyths|eason|easons|boots online/i, categoryId: "cat_shopping" },
  { pattern: /cinema|odeon|omniplex|ticketmaster|eventbrite|steam|gym|flyefit|ben dunne|puregym|westwood/i, categoryId: "cat_entertainment" },
  { pattern: /ryanair|aer lingus|easyjet|booking\.com|airbnb|hotel|expedia|stena|irish ferries/i, categoryId: "cat_travel" },
  { pattern: /local property tax|\blpt\b|revenue commissioners|council tax/i, categoryId: "cat_lpt" },
  { pattern: /\brent\b|landlord|rtb|mortgage|ebs|haven|avant money|bank of ireland mortgage|nationwide bs/i, categoryId: "cat_rent" },
  { pattern: /home insurance|house insurance/i, categoryId: "cat_home_insurance" },
  { pattern: /cr[eè]che|childcare|after-?school/i, categoryId: "cat_childcare" },
  { pattern: /credit union loan|loan repayment|klarna|paypal pay in 3|clearpay|humm|pcp|finance payment|card payment received|credit card payment/i, categoryId: "cat_debt_payments" },
  { pattern: /salary|payroll|wages|\bpay\b.*ltd/i, categoryId: "cat_salary" },
  { pattern: /fee|charge|interest charged|maintenance fee/i, categoryId: "cat_fees" },
];

export function ruleMatches(rule: CategoryRule, t: Pick<Transaction, "payee" | "rawDescription" | "amountMinor" | "accountId">): boolean {
  const m = rule.match;
  const text = `${t.payee} ${t.rawDescription}`.toLowerCase();
  if (m.payeeContains && !text.includes(m.payeeContains.toLowerCase())) return false;
  if (m.regex) {
    try {
      if (!new RegExp(m.regex, "i").test(text)) return false;
    } catch {
      return false;
    }
  }
  if (m.minMinor !== undefined && t.amountMinor < m.minMinor) return false;
  if (m.maxMinor !== undefined && t.amountMinor > m.maxMinor) return false;
  if (m.accountId && t.accountId !== m.accountId) return false;
  return !!(m.payeeContains || m.regex || m.minMinor !== undefined || m.maxMinor !== undefined || m.accountId);
}

/** User rules first (highest priority wins), then the merchant dictionary. */
export function categorise(
  t: Pick<Transaction, "payee" | "rawDescription" | "amountMinor" | "accountId">,
  rules: readonly CategoryRule[],
): { categoryId: string | null; source: Transaction["categorySource"] } {
  const rule = [...rules].sort((a, b) => b.priority - a.priority).find((r) => ruleMatches(r, t));
  if (rule) return { categoryId: rule.categoryId, source: "rule" };
  const text = `${t.payee} ${t.rawDescription}`;
  const dict = MERCHANT_DICTIONARY.find((d) => d.pattern.test(text));
  if (dict) {
    // Income-looking words on an outflow are not salary.
    if (dict.categoryId === "cat_salary" && t.amountMinor < 0) return { categoryId: null, source: "none" };
    return { categoryId: dict.categoryId, source: "dictionary" };
  }
  return { categoryId: null, source: "none" };
}

/** Normalises a payee into a stable match string for a suggested rule. */
export function payeeKey(payee: string): string {
  return payee
    .toLowerCase()
    .replace(/\d{3,}/g, "")
    .replace(/[*#].*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** After a user corrects one transaction, offer a rule that would categorise similar ones. */
export function suggestRule(t: Transaction, categoryId: string): CategoryRule | null {
  const key = payeeKey(t.payee || t.rawDescription);
  if (key.length < 3) return null;
  return { id: newId("rule"), match: { payeeContains: key }, categoryId, priority: 10 };
}

/** Recategorises everything not set by hand. User corrections are never overwritten. */
export function recategorise(transactions: readonly Transaction[], rules: readonly CategoryRule[]): Transaction[] {
  return transactions.map((t) => {
    if (t.categorySource === "user") return t;
    const r = categorise(t, rules);
    return { ...t, categoryId: r.categoryId, categorySource: r.source };
  });
}
