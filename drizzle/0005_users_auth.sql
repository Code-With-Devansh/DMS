DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'role') THEN
    CREATE TYPE "public"."role" AS ENUM(
      'INVESTIGATING_OFFICER',
      'SUPERVISOR',
      'PROSECUTOR',
      'JUDGE',
      'COURT_CLERK',
      'FORENSIC_ANALYST',
      'RECORDS_ADMIN',
      'SECURITY_ADMIN',
      'ORG_ADMIN',
      'SYSTEM_ADMIN',
      'AUDITOR'
    );
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'status') THEN
CREATE TYPE "public"."status" AS ENUM(
      'ACTIVE',
    'DISABLED'
    );
END IF;
END $$;

CREATE TABLE IF NOT EXISTS users (
                       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

                       username TEXT NOT NULL,
                       hashed_password TEXT NOT NULL,
                       full_name TEXT NOT NULL,

                       role role NOT NULL,
                       org TEXT NOT NULL,
                       badge_id TEXT,

                       email TEXT NOT NULL,
                       clearance classification NOT NULL,
                       jurisdiction TEXT NOT NULL,
                       status status NOT NULL,

                       mfa_enrolled BOOLEAN NOT NULL DEFAULT FALSE,
                       mfa_temp_secret TEXT,
                       mfa_secret TEXT,
                       backup_codes TEXT,

                       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                       last_login_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS users_username_key
    ON users (username);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_key
    ON users (email);

CREATE INDEX IF NOT EXISTS users_role_idx
    ON users (role);

CREATE INDEX IF NOT EXISTS users_org_idx
    ON users (org);

CREATE INDEX IF NOT EXISTS users_status_idx
    ON users (status);
--> statement-breakpoint
