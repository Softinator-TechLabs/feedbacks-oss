import type { Database } from "./db.js";

export async function migrateProjectBoard(db: Database) {
  await db.query(`CREATE TABLE project_boards (
    project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    revision integer NOT NULL DEFAULT 1,
    configuration jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await db.query(`CREATE TABLE board_batch_receipts (
    id uuid PRIMARY KEY,
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    actor_id uuid NOT NULL,
    request_key text NOT NULL,
    input_hash text NOT NULL,
    receipt jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(actor_id,request_key)
  );`);
}
