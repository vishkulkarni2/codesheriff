-- PostgreSQL init script for CodeSheriff local development
-- Runs once when the container is first created.

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";   -- For full-text search on findings

-- Create a read-only role for analytics queries (optional, used by reporting tools)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'codesheriff_readonly') THEN
    CREATE ROLE codesheriff_readonly;
    GRANT CONNECT ON DATABASE codesheriff TO codesheriff_readonly;
    GRANT USAGE ON SCHEMA public TO codesheriff_readonly;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT ON TABLES TO codesheriff_readonly;
  END IF;
END
$$;
