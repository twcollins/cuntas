// Turns bank text into a merchant name a person would recognise: "TRADER JOE'S #123 SAN FRANCISCO CA"
// becomes "Trader Joe's". The bank's text is kept as rawDescription for search and rules.

/** Card-terminal and bank wording in front of the merchant. Removed repeatedly, so they can stack. */
const PREFIXES = [
  /^(?:POS|DEBIT|CREDIT)\s+(?:DEBIT|PURCHASE|CARD PURCHASE)\b\s*-?\s*/i,
  /^(?:DEBIT|CREDIT|CHECK)\s*CARD\s+PURCHASE\b\s*-?\s*/i,
  /^CHECKCARD\s+\d{4}\s+/i,
  /^(?:RECURRING\s+)?PURCHASE\s+(?:AUTHORIZED|AUTH)\s+ON\s+\d{2}\/\d{2}\s+/i,
  /^PURCHASE\s+(?:\d{4}\s+)?/i,
  /^(?:POS|VDP|VDC|VDA|D\/D|BGC|FPI|FPO)\s*[-:]?\s+/i,
  /^(?:VDP|VDC|VDA)-/i,
  /^(?:CARD PAYMENT TO|PAYMENT TO)\s+/i,
];

/** Payment processors that put their own name before the merchant's: "SQ *BLUE BOTTLE". */
const PROCESSOR = /^(?:SQ|TST|SP|PAYPAL|PP|PY|IZ|ZETTLE_?|SUMUP|CKO|GOOGLE)\s?\*\s?/i;

/** Big merchants whose bank text varies too much to clean: matched on the text, named outright. */
const ALIASES: [RegExp, string][] = [
  [/^(?:amazon|amzn)\s*prime\b|^prime video/i, "Amazon Prime"],
  [/^amzn\b|^amazon\b|^amazon\.com/i, "Amazon"],
  [/^netflix/i, "Netflix"],
  [/^apple\.com|^apple com bill/i, "Apple"],
  [/^wal-?mart\b|^walmart|^wm supercenter/i, "Walmart"],
  [/^cvs\b/i, "CVS Pharmacy"],
  [/^whole foods/i, "Whole Foods"],
  [/^costco gas/i, "Costco Gas"],
  [/^costco\b/i, "Costco"],
  [/^doordash/i, "DoorDash"],
  [/^ebay/i, "eBay"],
  [/^uber\s*eats/i, "Uber Eats"],
  [/^mcdonald'?s/i, "McDonald's"],
  [/^target\b/i, "Target"],
  [/^starbucks/i, "Starbucks"],
];

/** Bank references after the merchant: BofA's "DES:", ACH ids, "ON 12-09-2026". */
const TAILS = /\s+(?:DES:|ID:|INDN:|PPD\b|CCD\b|WEB\s+ID|CO\s+ID|ON\s+\d{2}[-/]\d{2}[-/]\d{2,4}\b).*$/i;

/** A store or terminal number and anything after it (usually the town): "#123", "STORE 12345", "T-0841", "0012345". */
const STORE_NUMBER = /\s+(?:#\s?\d+|STORE\s+#?\d+|[A-Z]{1,2}-?\d{3,}|\d{3,})\b.*$/i;

const US_STATES = new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" "));
/** First words of two-word town names, so "SAN FRANCISCO CA" goes whole. */
const TOWN_FIRST = new Set("SAN SANTA LOS LAS NEW ST SAINT FORT FT EL PALO SALT BATON CORPUS GRAND LONG NORTH SOUTH EAST WEST KANSAS OKLAHOMA JERSEY DES".split(" "));

const VOWELS = /[AEIOUY]/;
/** Joining words that read lower-case inside a name: "Zelle to Jordan". */
const SMALL = new Set(["TO", "OF", "AND", "THE", "FOR", "AT", "ON", "IN", "FROM"]);

/** "TRADER JOE'S" → "Trader Joe's"; words already in mixed case, and short codes like "CVS", "PG&E" and "LLC", stay. */
function titleCase(s: string): string {
  return s
    .split(" ")
    .map((word, i) => {
      if (/[a-z]/.test(word) || !/[A-Z]/.test(word)) return word;
      if (i > 0 && SMALL.has(word)) return word.toLowerCase();
      return word
        .split(/([-/])/)
        .map((part) => {
          if (part.includes("&") || (/^[A-Z]{2,4}$/.test(part) && !VOWELS.test(part) && part !== "LTD")) return part;
          return part.charAt(0) + part.slice(1).toLowerCase();
        })
        .join("");
    })
    .join(" ");
}

/** Removes a trailing US state and the town before it, keeping at least one word. */
function dropTown(s: string): string {
  const words = s.split(" ");
  if (words.length < 2 || !US_STATES.has(words[words.length - 1]!)) return s;
  words.pop();
  if (words.length > 1) {
    words.pop();
    if (words.length > 1 && TOWN_FIRST.has(words[words.length - 1]!.toUpperCase())) words.pop();
  }
  return words.join(" ");
}

/** A readable merchant name from bank text. Never empty unless the text is. */
export function cleanMerchant(raw: string): string {
  const original = raw.replace(/\s+/g, " ").trim();
  let s = original;
  for (let changed = true; changed; ) {
    changed = false;
    for (const p of PREFIXES) {
      const next = s.replace(p, "");
      if (next !== s && next.trim()) {
        s = next.trim();
        changed = true;
      }
    }
  }
  // Card numbers: "XXXXX1234", "****1234", "CARD 1234".
  s = s.replace(/\bX{2,}\d{2,}\b/gi, "").replace(/\*{2,}\d+/g, "").replace(/\bCARD\s+\d{4}\b/gi, "").replace(/\s+/g, " ").trim();
  s = s.replace(PROCESSOR, "");
  const alias = ALIASES.find(([p]) => p.test(s));
  if (alias) return alias[1];
  s = s.replace(TAILS, "");
  // In all-caps bank text, what follows a "*" is an order or trip reference: "LYFT *RIDE TUE 8PM".
  if (!/[a-z]/.test(s) && s.includes("*")) {
    const before = s.slice(0, s.indexOf("*")).trim();
    if (before) s = before;
  }
  s = s
    .replace(/\b\d{3}[-.]\d{3}[-.]?\d{4}\b|\b\d{3}-\d{7}\b/g, "") // phone numbers
    .replace(/\b\d{2}\/\d{2}(?:\/\d{2,4})?\b/g, "") // dates
    .replace(/\s+/g, " ")
    .trim();
  s = s.replace(STORE_NUMBER, "");
  s = s.replace(/\s+(?:USA|US)$/i, "");
  s = dropTown(s);
  s = titleCase(s).replace(/[\s,*#-]+$/, "").trim();
  return s || original;
}
