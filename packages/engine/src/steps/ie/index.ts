import { trackBudget } from "./0-track-budget";
import { starterFund } from "./1-starter-fund";
import { employerMatch } from "./2-employer-match";
import { debt } from "./3-debt";
import { requiredPurchases } from "./4-required-purchases";
import { retirement } from "./5-retirement";
import { advanced } from "./6-advanced";

export const IE_STEPS = [trackBudget, starterFund, employerMatch, debt, requiredPurchases, retirement, advanced];
