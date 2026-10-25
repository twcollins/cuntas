-- US support, phase 1: households may keep their books in US dollars. FX rates already store any
-- ECB quote currency (fx_rates.quote is char(3)); the ECB publishes USD alongside GBP.

ALTER TABLE households DROP CONSTRAINT IF EXISTS households_base_currency_check;
ALTER TABLE households ADD CONSTRAINT households_base_currency_check CHECK (base_currency IN ('EUR', 'GBP', 'USD'));
