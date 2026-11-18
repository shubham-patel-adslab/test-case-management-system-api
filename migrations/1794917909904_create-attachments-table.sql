-- Up Migration

-- Files attached to a recorded execution (PRD "Add comments and attachments to test runs", "Secure file
-- upload"). The file itself is on disk (UPLOAD_DIR) under stored_name — a random name, never the client's —
-- and is downloaded only through the authorized API. mime_type is detected from the file's content, not
-- taken from the client.
CREATE TABLE attachments (
    id                integer      GENERATED ALWAYS AS IDENTITY,
    test_execution_id integer      NOT NULL,
    -- The client's file name, for display and the download's Content-Disposition only.
    original_name     varchar(255) NOT NULL,
    stored_name       varchar(100) NOT NULL,
    mime_type         varchar(100) NOT NULL,
    size_bytes        integer      NOT NULL,
    uploaded_by       uuid         NULL,
    created_at        timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT pk_attachments PRIMARY KEY (id),
    CONSTRAINT uq_attachments_stored_name UNIQUE (stored_name),
    -- RESTRICT: a recorded execution is never deleted, so neither are its files' rows.
    CONSTRAINT fk_attachments_test_executions
        FOREIGN KEY (test_execution_id) REFERENCES test_executions (id) ON DELETE RESTRICT,
    CONSTRAINT fk_attachments_users_uploaded_by
        FOREIGN KEY (uploaded_by) REFERENCES users (id) ON DELETE SET NULL,
    -- 1 byte to 10 MB (api-requirements §8).
    CONSTRAINT ck_attachments_size_bytes CHECK (size_bytes BETWEEN 1 AND 10485760)
);

CREATE INDEX idx_attachments_test_execution_id ON attachments (test_execution_id);
CREATE INDEX idx_attachments_uploaded_by ON attachments (uploaded_by);

-- Down Migration

DROP TABLE attachments;
