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

type Entry = { pattern: RegExp; categoryId: string };

/** Card payments seen on the card: money moved, never income. */
const CARD_PAYMENTS: Entry[] = [{ pattern: /payment.{0,4}thank you|thank you.{0,4}payment|autopay payment/i, categoryId: "cat_transfer" }];

/** Irish and UK merchants. */
const IE_UK: Entry[] = [
  { pattern: /tesco|dunnes|supervalu|super valu|lidl|aldi|\bspar\b|\bcentra\b|londis|\bmace\b|sainsbury|asda|morrisons|waitrose|co-?op food|m&s food|\biceland\b/i, categoryId: "cat_groceries" },
  { pattern: /electric ireland|bord g[aá]is|sse airtricity|energia|flogas|panda power|pinergy|community power|yuno|octopus energy|british gas|edf energy|\be\.?on\b|power ni|budget energy/i, categoryId: "cat_energy" },
  { pattern: /uisce [eé]ireann|irish water|panda waste|greyhound(?! lines| bus)|city bin|thames water|nw water/i, categoryId: "cat_water_bins" },
  { pattern: /boots|pharmacy|chemist|hickey'?s|lloyds pharmacy|superdrug/i, categoryId: "cat_toiletries" },
  { pattern: /\bvhi\b|\blaya\b|irish life health|level health|bupa|axa health/i, categoryId: "cat_health_insurance" },
  { pattern: /leap card|\btfi\b|irish rail|iarnr[oó]d|dublin bus|bus [eé]ireann|luas|go-?ahead|translink|\btfl\b|trainline|circle k|applegreen|maxol|texaco|topaz|\bemo\b|\bshell\b|\bbp\b|\besso\b|parking|eflow|\bm50\b/i, categoryId: "cat_commute" },
  { pattern: /motor tax|\bnct\b|aviva|\baxa\b|allianz|liberty insurance|\bfbd\b|zurich|an post insurance|chill insurance|123\.ie|dvla|\bmot\b/i, categoryId: "cat_car" },
  { pattern: /\beir\b|vodafone|three\.ie|\bthree\b|virgin media|\bsky\b|\bbt\b|bt group|48\.ie|gomo|tesco mobile|giffgaff|\bee\b|\bo2\b|pure telecom|digiweb/i, categoryId: "cat_phone_internet" },
  { pattern: /netflix|spotify|disney ?(?:\+|plus)|disney(?!land| ?world| ?resort| ?parks| ?on ice)|amazon prime|apple\.com|icloud|youtube premium|now tv|tv licen[cs]e|xbox|playstation|audible/i, categoryId: "cat_tv_subs" },
  { pattern: /deliveroo|just ?eat|uber ?eats|insomnia|starbucks|costa coffee|\bcosta\b(?! mesa| rica)|\bpret\b|butlers|supermac|mcdonald|eddie rocket|nando|subway|burger king|domino|apache pizza|wetherspoon|\bpub\b|\bbar\b|restaurant|caf[eé]/i, categoryId: "cat_eating_out" },
  { pattern: /penneys|primark|zara|h&m|\bnext\b|tk ?maxx|tj ?maxx|amazon|\bamzn\b|argos|harvey norman|currys|ikea|smyths|eason|easons|boots online/i, categoryId: "cat_shopping" },
  { pattern: /cinema|odeon|omniplex|ticketmaster|eventbrite|steam|\bgym\b|flyefit|ben dunne|puregym|westwood/i, categoryId: "cat_entertainment" },
  { pattern: /ryanair|aer lingus|easyjet|booking\.com|airbnb|hotel|expedia|stena|irish ferries/i, categoryId: "cat_travel" },
  { pattern: /local property tax|\blpt\b|revenue commissioners|council tax/i, categoryId: "cat_lpt" },
  { pattern: /\brent\b|landlord|\brtb\b|mortgage|\bebs\b|haven mortgages?|avant money|bank of ireland mortgage|nationwide bs/i, categoryId: "cat_rent" },
  { pattern: /home insurance|house insurance/i, categoryId: "cat_home_insurance" },
  { pattern: /cr[eè]che|childcare|after-?school/i, categoryId: "cat_childcare" },
  { pattern: /credit union loan|loan repayment|klarna|paypal pay in 3|clearpay|\bhumm\b|\bpcp\b|finance payment|card payment received|credit card payment/i, categoryId: "cat_debt_payments" },
];

/** US merchants and bill payees. More specific patterns come first (gas at a warehouse club before the club). */
const US: Entry[] = [
  { pattern: /costco gas|sam'?s club fuel|walmart fuel|kroger fuel|safeway fuel|supercharger|chargepoint|\bevgo\b/i, categoryId: "cat_commute" },
  { pattern: /disneyland|disney world|walt disney world|universal studios|six flags|cedar point|seaworld/i, categoryId: "cat_entertainment" },
  {
    pattern:
      /trader joe|whole foods|whole fds|safeway|kroger|costco|sam'?s club|wal-?mart|walmart|wm supercenter|\bpublix\b|albertsons|\bh-?e-?b\b|wegmans|meijer|food lion|giant eagle|stop & shop|hy-?vee|winco|sprouts|ralphs|\bvons\b|fred meyer|king soopers|harris teeter|shoprite|piggly wiggly|winn-?dixie|smart & final|instacart|freshdirect|jewel-?osco|food 4 less|grocery outlet|market basket|save mart|stater bro|fry'?s food|smith'?s food|\bdillons\b|giant food|food city|ingles|schnucks|lowes foods|supermarket|grocery|groceries/i,
    categoryId: "cat_groceries",
  },
  {
    pattern:
      /pg&e|\bpge\b|con ?ed\b|coned|consolidated edison|duke energy|dominion energy|southern california edison|\bsce\b|xcel energy|\bfpl\b|florida power|georgia power|entergy|national grid|eversource|\bcomed\b|pse&g|dte energy|consumers energy|\baep\b|ameren|\bppl\b|\bpeco\b|sdg&e|reliant energy|\btxu\b|centerpoint|atmos energy|spire energy|nicor gas|socalgas|peoples gas|puget sound energy|\baps\b|\bsrp\b|nv energy|rocky mountain power|pacificorp|duquesne light|electric co|power co|gas co\b/i,
    categoryId: "cat_energy",
  },
  { pattern: /waste management|\bwm\.com|republic services|water dept|water utility|water & sewer|american water|\bsewer\b|trash service/i, categoryId: "cat_water_bins" },
  { pattern: /\bcvs\b|walgreens|rite aid|duane reade/i, categoryId: "cat_toiletries" },
  { pattern: /blue cross|blue shield|\bbcbs\b|aetna|cigna|unitedhealth|\buhc\b|humana|kaiser|anthem|oscar health|ambetter/i, categoryId: "cat_health_insurance" },
  {
    pattern:
      /chevron|exxon|\bmobil\b|sunoco|valero|marathon petro|speedway|\bwawa\b|sheetz|quiktrip|\bqt\b \d|phillips 66|\barco\b|casey'?s|pilot travel|flying j|love'?s travel|racetrac|\buber\b|\blyft\b|\bmta\b|\bbart\b|clipper|ventra|septa|wmata|\bmbta\b|amtrak|e-?z ?pass|fastrak|sunpass|txtag|\btolls?\b|caltrain|\bmetra\b|nj transit|parkmobile|spothero/i,
    categoryId: "cat_commute",
  },
  { pattern: /geico|progressive ins|progressive\b.*\bauto|state farm|allstate|liberty mutual|farmers ins|\busaa\b|nationwide|travelers ins|\bdmv\b|jiffy lube|autozone|o'?reilly auto|advance auto|pep boys|firestone|discount tire|midas|valvoline|smog check|car wash/i, categoryId: "cat_car" },
  {
    pattern:
      /verizon|at&t|\batt\b|t-?mobile|sprint\b|comcast|xfinity|spectrum|charter comm|cox comm|google ?fi\b|mint mobile|cricket wireless|boost mobile|visible wireless|frontier comm|centurylink|optimum|starlink|us mobile/i,
    categoryId: "cat_phone_internet",
  },
  {
    pattern:
      /\bhulu\b|hbo ?max|\bmax\.com|paramount\+|paramount plus|peacock|apple tv|sling\.com|sling tv|youtube ?tv|espn\+|espn plus|pandora|siriusxm|sirius xm|kindle unltd|kindle unlimited|google storage|google one|microsoft 365|dropbox|patreon|\bnyt\b|new york times|washington post|peloton/i,
    categoryId: "cat_tv_subs",
  },
  {
    pattern:
      /chipotle|chick-?fil-?a|taco bell|wendy'?s|dunkin|panera|panda express|pizza hut|papa john|little caesars|sweetgreen|shake shack|in-?n-?out|five guys|jack in the box|sonic drive|arby'?s|popeyes|\bkfc\b|olive garden|applebee|chili'?s\b|cheesecake factory|buffalo wild|\bihop\b|denny'?s|waffle house|cracker barrel|outback|red robin|texas roadhouse|doordash|grubhub|postmates|seamless|caviar|tim hortons|peet'?s|blue bottle|dutch bros|jersey mike|jimmy john|firehouse subs|wingstop|qdoba|\bcava\b|raising cane|whataburger|culver'?s|zaxby|bojangles|krispy kreme|dairy queen|baskin|cold stone|smoothie king|jamba|\btst\* ?|coffee|pizza|taqueria|sushi|\bbbq\b|bakery|\bgrill\b|\bdiner\b|\bdeli\b|bistro|brewing|tavern|steakhouse/i,
    categoryId: "cat_eating_out",
  },
  {
    pattern:
      /\btarget\b|best buy|home depot|lowe'?s|macy'?s|nordstrom|kohl'?s|marshalls|ross stores|ross dress|old navy|\bgap\b|banana republic|\bnike\b|adidas|etsy|\bebay\b|wayfair|bed bath|dollar tree|dollar general|family dollar|five below|big lots|staples|office depot|michaels|hobby lobby|joann|petco|petsmart|chewy|apple store|uniqlo|sephora|ulta|bath & body|victoria'?s secret|foot locker|dick'?s sporting|\brei\b|shein|\btemu\b|burlington|saks|bloomingdale|ace hardware|menards|tractor supply|gamestop|barnes & noble|\btjx\b|homegoods|container store|crate & barrel|pottery barn|williams-sonoma/i,
    categoryId: "cat_shopping",
  },
  {
    pattern:
      /\bamc\b|regal|cinemark|fandango|stubhub|live nation|seatgeek|planet fitness|la fitness|equinox|24 hour fitness|orangetheory|crunch fitness|classpass|topgolf|dave & buster|bowlero|nintendo|\bymca\b/i,
    categoryId: "cat_entertainment",
  },
  {
    pattern:
      /delta air|united air|united\.com|american air|\baa\.com|southwest air|southwes|jetblue|alaska air|spirit air|frontier air|hawaiian air|marriott|hilton|hyatt|\bihg\b|holiday inn|best western|\bvrbo\b|priceline|kayak|hertz|\bavis\b|enterprise rent|budget rent|alamo|national car|tsa precheck|global entry/i,
    categoryId: "cat_travel",
  },
  { pattern: /property tax|county treasurer|tax collector/i, categoryId: "cat_lpt" },
  { pattern: /rocket mortgage|mr\.? cooper|quicken loans|appfolio|rentcafe|\bbilt\b|zillow rent|cozy\.co|rent payment|home mortgage/i, categoryId: "cat_rent" },
  { pattern: /lemonade ins|homeowners ins|hippo ins|renters ins/i, categoryId: "cat_home_insurance" },
  { pattern: /kindercare|bright horizons|daycare|day care|brightwheel|care\.com|learning center/i, categoryId: "cat_childcare" },
  {
    pattern:
      /sallie mae|navient|nelnet|mohela|great lakes|fedloan|aidvantage|sofi loan|upstart|lendingclub|\baffirm\b|afterpay|toyota financial|honda financial|ally auto|capital one auto|santander consumer|auto loan|student loan|loan pmt|loan payment/i,
    categoryId: "cat_debt_payments",
  },
  { pattern: /gofundme|red cross|united way|salvation army|donation|charity/i, categoryId: "cat_gifts" },
  { pattern: /dir dep|direct dep|\bgusto\b|\badp\b|paychex/i, categoryId: "cat_salary" },
  { pattern: /interest paid|interest earned|dividend|irs treas.*tax ref|tax refund/i, categoryId: "cat_other_income" },
];

/** Words that mean the same thing in any country; checked last. */
const GENERIC: Entry[] = [
  { pattern: /salary|payroll|wages|\bpay\b.*ltd/i, categoryId: "cat_salary" },
  { pattern: /\bfees?\b|\bcharges?\b|interest charged|overdraft/i, categoryId: "cat_fees" },
];

/** The merchant dictionary: Irish, UK and US merchants. Checked after the user's own rules. */
export const MERCHANT_DICTIONARY: Entry[] = [...CARD_PAYMENTS, ...IE_UK, ...US, ...GENERIC];

/** Categories that only describe money coming in. */
const INCOME_ONLY = new Set(["cat_salary", "cat_other_income"]);

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
    // Income-looking words on an outflow are not income.
    if (INCOME_ONLY.has(dict.categoryId) && t.amountMinor < 0) return { categoryId: null, source: "none" };
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
