import type { Database } from "./db.js";
export async function migratePublicIntake(db: Database) {
  await db.query(
    `CREATE TABLE public_intake(project_id uuid PRIMARY KEY REFERENCES projects(id),id uuid NOT NULL UNIQUE,revision integer NOT NULL DEFAULT 1,enabled boolean NOT NULL DEFAULT false,data jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now())`,
  );
  await db.query(
    `CREATE TABLE public_intake_budgets(key text NOT NULL,bucket timestamptz NOT NULL,count integer NOT NULL DEFAULT 1,PRIMARY KEY(key,bucket))`,
  );
  await db.query(
    `CREATE INDEX public_intake_budgets_expiry ON public_intake_budgets(bucket)`,
  );
  await db.query(
    `CREATE TABLE public_intake_receipts(intake_id uuid NOT NULL REFERENCES public_intake(id),request_id uuid NOT NULL,input_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(intake_id,request_id))`,
  );
}
