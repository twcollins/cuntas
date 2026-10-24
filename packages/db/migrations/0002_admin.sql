-- Instance administration: admins can create, suspend, rename and delete households and manage
-- memberships, but never read a household's ledger (the document stays encrypted and is only
-- served to members).

ALTER TABLE users ADD COLUMN is_admin boolean NOT NULL DEFAULT false;
ALTER TABLE households ADD COLUMN suspended_at timestamptz;
ALTER TABLE invites ADD COLUMN role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member'));

-- The API role cannot make anyone an admin: only the table owner or a superuser (the admin CLI)
-- can set is_admin. A trigger rather than column grants, because ORMs list every column on insert.
CREATE OR REPLACE FUNCTION users_guard_admin() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE privileged boolean;
BEGIN
  SELECT r.rolsuper OR r.rolname = (SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'users')
    INTO privileged FROM pg_roles r WHERE r.rolname = current_user;
  IF privileged THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' AND NEW.is_admin THEN RAISE EXCEPTION 'only the database owner can create admins' USING ERRCODE = '42501'; END IF;
  IF TG_OP = 'UPDATE' AND NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN RAISE EXCEPTION 'only the database owner can change admin status' USING ERRCODE = '42501'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER users_guard_admin BEFORE INSERT OR UPDATE ON users FOR EACH ROW EXECUTE FUNCTION users_guard_admin();

CREATE OR REPLACE FUNCTION app_is_admin() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT is_admin FROM users WHERE id = app_user_id()), false)
$$;

-- Lists every household with metadata only. Returns nothing unless the session user is an admin.
CREATE OR REPLACE FUNCTION admin_households() RETURNS TABLE (
  id uuid, name text, base_currency text, created_at timestamptz, suspended_at timestamptz,
  member_count bigint, owner_names text[], document_version integer, document_updated_at timestamptz, connection_count bigint
)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT h.id, h.name, h.base_currency::text, h.created_at, h.suspended_at,
    (SELECT count(*) FROM memberships m WHERE m.household_id = h.id),
    coalesce((SELECT array_agg(u.display_name ORDER BY u.display_name) FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.household_id = h.id AND m.role = 'owner'), '{}'),
    d.version, d.updated_at,
    (SELECT count(*) FROM connections c WHERE c.household_id = h.id)
  FROM households h LEFT JOIN household_documents d ON d.household_id = h.id
  WHERE app_is_admin()
  ORDER BY h.created_at
$$;

-- Invites now carry the role they grant, so an admin can hand a new household to its owner.
CREATE OR REPLACE FUNCTION accept_invite(p_token_hash text, p_user uuid) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE hh uuid; r text;
BEGIN
  UPDATE invites SET used_at = now(), used_by = p_user
    WHERE token_hash = p_token_hash AND used_at IS NULL AND expires_at > now()
    RETURNING household_id, role INTO hh, r;
  IF hh IS NULL THEN RAISE EXCEPTION 'invalid or expired invite'; END IF;
  INSERT INTO memberships (household_id, user_id, role) VALUES (hh, p_user, r)
    ON CONFLICT (household_id, user_id) DO UPDATE SET role = CASE WHEN EXCLUDED.role = 'owner' THEN 'owner' ELSE memberships.role END;
  INSERT INTO audit_events (household_id, actor, action, entity) VALUES (hh, p_user, 'invite.accept', 'membership');
  RETURN hh;
END $$;

GRANT EXECUTE ON FUNCTION app_is_admin(), admin_households() TO cuntas_app;
