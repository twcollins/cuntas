-- Cúntas server schema. The household's ledger lives in household_documents as an
-- envelope-encrypted, versioned JSON document (local-first sync); the server owns
-- auth, bank connections, provider transactions, FX rates and the audit trail.
--
-- Tenancy: every household-scoped table has row-level security keyed on
-- current_setting('app.household_id'). The API connects as cuntas_app, which is
-- not the table owner and cannot bypass RLS.


DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cuntas_app') THEN
    CREATE ROLE cuntas_app NOLOGIN NOBYPASSRLS;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION app_household_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.household_id', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL,
  email text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE passkey_credentials (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key bytea NOT NULL,
  counter bigint NOT NULL DEFAULT 0,
  transports text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE TABLE totp_secrets (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_encrypted text NOT NULL,
  confirmed boolean NOT NULL DEFAULT false
);

CREATE TABLE sessions (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  reauth_at timestamptz NOT NULL DEFAULT now(),
  user_agent_hash text
);

CREATE TABLE households (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  base_currency char(3) NOT NULL CHECK (base_currency IN ('EUR', 'GBP')),
  dek_encrypted text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, user_id)
);

CREATE TABLE invites (
  token_hash text PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  used_by uuid REFERENCES users(id)
);

CREATE TABLE household_documents (
  household_id uuid PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
  version integer NOT NULL,
  ciphertext text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id)
);

CREATE TABLE connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  provider text NOT NULL,
  institution_name text NOT NULL,
  institution_country char(2) NOT NULL,
  session_ref_encrypted text,
  consent_state text,
  consent_expires_at timestamptz,
  status text NOT NULL CHECK (status IN ('pending', 'active', 'expired', 'revoked', 'error')),
  accounts jsonb NOT NULL DEFAULT '[]',
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE provider_transactions (
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  account_ref text NOT NULL,
  external_id text NOT NULL,
  booked_at date NOT NULL,
  payload_encrypted text NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (connection_id, account_ref, external_id)
);

CREATE TABLE audit_events (
  id bigserial PRIMARY KEY,
  household_id uuid REFERENCES households(id) ON DELETE CASCADE,
  actor uuid,
  action text NOT NULL,
  entity text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE fx_rates (
  date date NOT NULL,
  base char(3) NOT NULL DEFAULT 'EUR',
  quote char(3) NOT NULL,
  rate numeric(12, 6) NOT NULL,
  source text NOT NULL,
  PRIMARY KEY (date, base, quote)
);

CREATE TABLE notifications (
  id bigserial PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  kind text NOT NULL,
  due_on date NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  sent_at timestamptz,
  UNIQUE (household_id, kind, due_on)
);

-- Row-level security
ALTER TABLE households ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE household_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY households_tenant ON households USING (id = app_household_id()) WITH CHECK (id = app_household_id());
-- Members can list their own memberships across households (to pick one) but only see others in the current household.
CREATE POLICY memberships_tenant ON memberships
  USING (household_id = app_household_id() OR user_id = app_user_id())
  WITH CHECK (household_id = app_household_id());
CREATE POLICY invites_tenant ON invites USING (household_id = app_household_id()) WITH CHECK (household_id = app_household_id());
CREATE POLICY documents_tenant ON household_documents USING (household_id = app_household_id()) WITH CHECK (household_id = app_household_id());
CREATE POLICY connections_tenant ON connections USING (household_id = app_household_id()) WITH CHECK (household_id = app_household_id());
CREATE POLICY provider_tx_tenant ON provider_transactions USING (household_id = app_household_id()) WITH CHECK (household_id = app_household_id());
CREATE POLICY audit_tenant ON audit_events USING (household_id = app_household_id()) WITH CHECK (household_id = app_household_id() OR household_id IS NULL);
CREATE POLICY notifications_tenant ON notifications USING (household_id = app_household_id()) WITH CHECK (household_id = app_household_id());

-- Invite acceptance happens before the user belongs to the household, so it runs as a definer function.
CREATE OR REPLACE FUNCTION accept_invite(p_token_hash text, p_user uuid) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE hh uuid;
BEGIN
  UPDATE invites SET used_at = now(), used_by = p_user
    WHERE token_hash = p_token_hash AND used_at IS NULL AND expires_at > now()
    RETURNING household_id INTO hh;
  IF hh IS NULL THEN RAISE EXCEPTION 'invalid or expired invite'; END IF;
  INSERT INTO memberships (household_id, user_id, role) VALUES (hh, p_user, 'member') ON CONFLICT DO NOTHING;
  INSERT INTO audit_events (household_id, actor, action, entity) VALUES (hh, p_user, 'invite.accept', 'membership');
  RETURN hh;
END $$;

-- Worker jobs run across households; they use this definer function to enumerate active connections only.
CREATE OR REPLACE FUNCTION connections_due_for_sync() RETURNS TABLE (id uuid, household_id uuid)
  LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT id, household_id FROM connections WHERE status = 'active'
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO cuntas_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO cuntas_app;
GRANT EXECUTE ON FUNCTION accept_invite(text, uuid), connections_due_for_sync(), app_household_id(), app_user_id() TO cuntas_app;
