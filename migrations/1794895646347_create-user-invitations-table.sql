-- Up Migration

-- The pending set-password invitation of an INVITED user — at most one per user (uq_user_invitations_user_id):
-- resending replaces it, accepting or deactivating deletes it, so an old link never keeps working.
-- Only a SHA-256 hash of the emailed token is stored: a database leak exposes no usable link. (SHA-256, not
-- bcrypt: the token is 256 random bits, so there is nothing to brute-force and lookups stay indexable.)
CREATE TABLE user_invitations (
    id          integer     GENERATED ALWAYS AS IDENTITY,
    user_id     uuid        NOT NULL,
    token_hash  char(64)    NOT NULL,
    expires_at  timestamptz NOT NULL,
    created_by  uuid        NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT pk_user_invitations PRIMARY KEY (id),
    CONSTRAINT uq_user_invitations_user_id UNIQUE (user_id),
    CONSTRAINT uq_user_invitations_token_hash UNIQUE (token_hash),
    CONSTRAINT fk_user_invitations_users FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_user_invitations_users_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT ck_user_invitations_expires_after_created CHECK (expires_at > created_at)
);

CREATE INDEX idx_user_invitations_created_by ON user_invitations (created_by);

-- Down Migration

DROP TABLE user_invitations;
