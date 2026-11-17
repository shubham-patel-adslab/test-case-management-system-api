-- Up Migration

-- Users are created by an admin only (no public registration); the role lives in user_roles. Lengths and
-- status values mirror src/features/user/user.constant.ts.
-- UUID id (decided 2026-11-17, users only): user ids appear in URLs and must not be guessable/enumerable.
-- gen_random_uuid() is built into PostgreSQL 13+, no extension needed.
-- The API stores email lowercased and ck_users_email_lowercase guarantees it, so the plain UNIQUE
-- constraint is case-insensitive in effect and login is a simple `email = $1` lookup on its index.
-- last_name is optional (decided 2026-11-17 — not everyone has one): NULL when absent, never ''
-- (ck_users_last_name_not_blank still rejects a blank value; CHECK passes on NULL).
-- A user starts INVITED with no password; accepting the emailed invitation sets the password and makes
-- them ACTIVE (user_invitations). ck_users_active_has_password guarantees an ACTIVE user can sign in.
CREATE TABLE users (
    id            uuid         NOT NULL DEFAULT gen_random_uuid(),
    first_name    varchar(100) NOT NULL,
    last_name     varchar(100) NULL,
    email         varchar(254) NOT NULL,
    password_hash text         NULL,
    status        text         NOT NULL DEFAULT 'INVITED',
    created_at    timestamptz  NOT NULL DEFAULT now(),
    updated_at    timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT pk_users PRIMARY KEY (id),
    CONSTRAINT uq_users_email UNIQUE (email),
    CONSTRAINT ck_users_first_name_not_blank CHECK (btrim(first_name) <> ''),
    CONSTRAINT ck_users_last_name_not_blank CHECK (btrim(last_name) <> ''),
    CONSTRAINT ck_users_email_lowercase CHECK (email = lower(email)),
    CONSTRAINT ck_users_status CHECK (status IN ('INVITED', 'ACTIVE', 'INACTIVE')),
    CONSTRAINT ck_users_active_has_password CHECK (status <> 'ACTIVE' OR password_hash IS NOT NULL)
);

-- Matches the user list's ORDER BY (newest first, id as the unique tie-breaker).
CREATE INDEX idx_users_created_at_id ON users (created_at DESC, id DESC);

-- Down Migration

DROP TABLE users;
