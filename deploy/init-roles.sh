#!/bin/sh
# Creates the non-owner login role the API and worker use. It cannot bypass row-level security.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE ROLE cuntas_app NOLOGIN NOBYPASSRLS;
CREATE ROLE cuntas_api LOGIN PASSWORD '${APP_DB_PASSWORD}' NOBYPASSRLS IN ROLE cuntas_app;
SQL
