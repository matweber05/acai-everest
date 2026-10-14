#!/usr/bin/env bash
# Roda as migrations + testes num PostgreSQL local (não usa o Supabase real).
# Uso: PGHOST=/tmp/pg PGPORT=5433 PGUSER=postgres ./supabase/tests/run.sh
set -eo pipefail
cd "$(dirname "$0")/.."
DB=${TEST_DB:-acai_test}
psql -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists $DB" -c "create database $DB"
for f in tests/00_supabase_shim.sql migrations/*.sql; do
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f" >/dev/null 2>&1 || { echo "Falha ao aplicar $f"; psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f"; exit 1; }
done
psql -q -o /dev/null -v ON_ERROR_STOP=1 -d "$DB" -f tests/01_business_rules.sql 2>&1 | sed 's/^psql:[^ ]* WARNING:  /  /'
bash tests/02_concurrency.sh "$DB"
