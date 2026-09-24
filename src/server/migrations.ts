import type { Database } from "./db.js";
export async function migrate(db: Database) {
  await db.transaction(async (tx) => {
    // Lock before creating the table: fresh replicas may start together.
    await tx.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('feedbacks.migrations',0))",
    );
    await tx.query(
      "CREATE TABLE IF NOT EXISTS migrations(version integer PRIMARY KEY,applied_at timestamptz DEFAULT now())",
    );
    if (!(await tx.one("SELECT version FROM migrations WHERE version=1"))) {
      const sql = `
CREATE TABLE users(id uuid PRIMARY KEY,email text UNIQUE NOT NULL,name text NOT NULL,password_hash text NOT NULL,owner boolean NOT NULL DEFAULT false,active boolean NOT NULL DEFAULT true,classification text NOT NULL DEFAULT 'employee',expertise jsonb NOT NULL DEFAULT '[]',policy jsonb NOT NULL DEFAULT '{"general":1}',policy_version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE projects(id uuid PRIMARY KEY,data jsonb NOT NULL,revision integer NOT NULL DEFAULT 1);
CREATE TABLE grants(project_id uuid REFERENCES projects(id),user_id uuid REFERENCES users(id),role text NOT NULL CHECK(role IN ('maintainer','reviewer','viewer')),can_resolve boolean NOT NULL DEFAULT false,policy jsonb,PRIMARY KEY(project_id,user_id));
CREATE TABLE sessions(hash text PRIMARY KEY,user_id uuid REFERENCES users(id),csrf_hash text NOT NULL,expires_at timestamptz NOT NULL);
CREATE TABLE invites(hash text PRIMARY KEY,email text NOT NULL,project_id uuid REFERENCES projects(id),role text NOT NULL,expires_at timestamptz NOT NULL,used_at timestamptz);
CREATE TABLE tokens(id uuid PRIMARY KEY,hash text UNIQUE NOT NULL,user_id uuid REFERENCES users(id),kind text NOT NULL,name text NOT NULL,projects jsonb NOT NULL,scopes jsonb NOT NULL,can_resolve boolean NOT NULL DEFAULT false,expires_at timestamptz NOT NULL,revoked_at timestamptz);
CREATE TABLE pairing(id uuid PRIMARY KEY,secret_hash text UNIQUE NOT NULL,name text NOT NULL,expires_at timestamptz NOT NULL,approved_by uuid REFERENCES users(id),consumed_at timestamptz);
CREATE TABLE threads(id uuid PRIMARY KEY,project_id uuid REFERENCES projects(id),data jsonb NOT NULL,revision integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE replies(id uuid PRIMARY KEY,thread_id uuid REFERENCES threads(id),data jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE view_likes(project_id uuid REFERENCES projects(id),fingerprint text NOT NULL,user_id uuid REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(project_id,fingerprint,user_id));
CREATE TABLE assets(id uuid PRIMARY KEY,project_id uuid REFERENCES projects(id),thread_id uuid REFERENCES threads(id),object_key text UNIQUE NOT NULL,data jsonb NOT NULL,status text NOT NULL CHECK(status IN ('validated','pending')));
CREATE TABLE instructions(id uuid PRIMARY KEY,project_id uuid REFERENCES projects(id),version integer NOT NULL,body text NOT NULL,actor jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(project_id,version));
CREATE TABLE events(cursor bigserial PRIMARY KEY,project_id uuid REFERENCES projects(id),entity_id text NOT NULL,kind text NOT NULL,actor jsonb NOT NULL,data jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE idempotency(actor_id text NOT NULL,operation text NOT NULL,key text NOT NULL,input_hash text NOT NULL,entity_id uuid NOT NULL,PRIMARY KEY(actor_id,operation,key));
CREATE TABLE export_snapshots(id uuid PRIMARY KEY,actor_id text NOT NULL,project_id uuid REFERENCES projects(id),data jsonb NOT NULL,expires_at timestamptz NOT NULL);
CREATE INDEX threads_project ON threads(project_id,updated_at DESC);
CREATE INDEX events_project ON events(project_id,cursor);
CREATE INDEX replies_thread ON replies(thread_id,created_at);
INSERT INTO migrations(version) VALUES(1);`;
      for (const statement of sql.split(";").filter((s) => s.trim()))
        await tx.query(statement);
    }
    if (!(await tx.one("SELECT version FROM migrations WHERE version=2"))) {
      const sql = `ALTER TABLE users ADD COLUMN username text;
ALTER TABLE users ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX users_username_ci ON users(lower(username)) WHERE username IS NOT NULL;
CREATE TABLE organization_identity(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),primary_owner_id uuid UNIQUE NOT NULL REFERENCES users(id));
INSERT INTO organization_identity(primary_owner_id) SELECT id FROM users WHERE owner=true ORDER BY created_at,id LIMIT 1;
CREATE TABLE private_member_notes(user_id uuid PRIMARY KEY REFERENCES users(id),body text NOT NULL DEFAULT '',revision integer NOT NULL DEFAULT 1);
CREATE TABLE reviewer_guidance(user_id uuid PRIMARY KEY REFERENCES users(id),body text NOT NULL DEFAULT '',revision integer NOT NULL DEFAULT 1);
CREATE TABLE account_links(id uuid PRIMARY KEY,hash text UNIQUE NOT NULL,user_id uuid NOT NULL REFERENCES users(id),kind text NOT NULL CHECK(kind IN ('reset','login')),expires_at timestamptz NOT NULL,used_at timestamptz,revoked_at timestamptz,session_hash text);
INSERT INTO migrations(version) VALUES(2);`;
      for (const statement of sql.split(";").filter((s) => s.trim()))
        await tx.query(statement);
    }
    if (!(await tx.one("SELECT version FROM migrations WHERE version=3"))) {
      const sql = `ALTER TABLE replies ADD CONSTRAINT replies_thread_identity UNIQUE(thread_id,id);
CREATE TABLE discussion_likes(thread_id uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,reply_id uuid,user_id uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(thread_id,reply_id) REFERENCES replies(thread_id,id) ON DELETE CASCADE);
CREATE UNIQUE INDEX discussion_likes_original ON discussion_likes(thread_id,user_id) WHERE reply_id IS NULL;
CREATE UNIQUE INDEX discussion_likes_reply ON discussion_likes(reply_id,user_id) WHERE reply_id IS NOT NULL;
CREATE INDEX discussion_likes_thread ON discussion_likes(thread_id);
INSERT INTO migrations(version) VALUES(3);`;
      for (const statement of sql.split(";").filter((s) => s.trim()))
        await tx.query(statement);
    }
    if (!(await tx.one("SELECT version FROM migrations WHERE version=4"))) {
      await tx.query(
        "ALTER TABLE tokens ADD COLUMN owner_admin boolean NOT NULL DEFAULT false",
      );
      await tx.query("INSERT INTO migrations(version) VALUES(4)");
    }
    if (!(await tx.one("SELECT version FROM migrations WHERE version=5"))) {
      const sql = `ALTER TABLE export_snapshots ADD COLUMN user_id uuid REFERENCES users(id);
ALTER TABLE export_snapshots ADD COLUMN byte_length bigint NOT NULL DEFAULT 0 CHECK(byte_length>=0);
UPDATE export_snapshots s SET byte_length=octet_length(data::text),user_id=COALESCE((SELECT id FROM users WHERE id::text=s.actor_id),(SELECT user_id FROM tokens WHERE id::text=s.actor_id));
CREATE INDEX export_snapshots_expiry ON export_snapshots(expires_at);
CREATE TABLE export_requests(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id),project_id uuid NOT NULL REFERENCES projects(id),created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX export_requests_created ON export_requests(created_at);
INSERT INTO migrations(version) VALUES(5);`;
      for (const statement of sql.split(";").filter((s) => s.trim()))
        await tx.query(statement);
    }
    if (!(await tx.one("SELECT version FROM migrations WHERE version=6"))) {
      await tx.query(
        `CREATE TABLE review_views(id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, name text NOT NULL, filters jsonb NOT NULL, revision integer NOT NULL DEFAULT 1)`,
      );
      await tx.query(
        "CREATE INDEX review_views_user_project ON review_views(user_id,project_id)",
      );
      await tx.query("CREATE INDEX threads_tags ON threads USING gin ((data->'tags'))");
      await tx.query("INSERT INTO migrations(version) VALUES(6)");
    }
    if (!(await tx.one("SELECT version FROM migrations WHERE version=7"))) {
      await tx.query("CREATE INDEX pairing_expiry ON pairing(expires_at)");
      await tx.query("INSERT INTO migrations(version) VALUES(7)");
    }
    if (!(await tx.one("SELECT version FROM migrations WHERE version=8"))) {
      const sql = `CREATE TABLE guest_links(id uuid PRIMARY KEY,hash text UNIQUE NOT NULL,thread_id uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,label text NOT NULL,created_by uuid NOT NULL REFERENCES users(id),expires_at timestamptz NOT NULL,revoked_at timestamptz,replies integer NOT NULL DEFAULT 0 CHECK(replies BETWEEN 0 AND 50),created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX guest_links_thread ON guest_links(thread_id,created_at DESC);
INSERT INTO migrations(version) VALUES(8);`;
      for (const statement of sql.split(";").filter((s) => s.trim()))
        await tx.query(statement);
    }
    if (!(await tx.one("SELECT version FROM migrations WHERE version=9"))) {
      await tx.query(`CREATE TABLE github_issue_requests(
        id uuid PRIMARY KEY,
        thread_id uuid NOT NULL UNIQUE REFERENCES threads(id),
        project_id uuid NOT NULL REFERENCES projects(id),
        request_key text NOT NULL,
        input_hash text NOT NULL,
        repository text NOT NULL,
        status text NOT NULL CHECK(status IN ('pending','linked')),
        issue_url text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
      await tx.query("INSERT INTO migrations(version) VALUES(9)");
    }
    if (!(await tx.one("SELECT version FROM migrations WHERE version=10"))) {
      const sql = `CREATE TABLE guest_project_links(id uuid PRIMARY KEY,hash text UNIQUE NOT NULL,project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,label text NOT NULL,created_by uuid NOT NULL REFERENCES users(id),expires_at timestamptz NOT NULL,revoked_at timestamptz,max_submissions integer NOT NULL CHECK(max_submissions BETWEEN 1 AND 50),submissions integer NOT NULL DEFAULT 0 CHECK(submissions>=0 AND submissions<=max_submissions),created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX guest_project_links_project ON guest_project_links(project_id,created_at DESC);
 INSERT INTO migrations(version) VALUES(10);`;
      for (const statement of sql.split(";").filter((s) => s.trim()))
        await tx.query(statement);
    }
    if (!(await tx.one("SELECT version FROM migrations WHERE version=11"))) {
      const sql = `CREATE TABLE webhook_configs(project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,url text NOT NULL,secret text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE webhook_deliveries(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,payload jsonb NOT NULL,status text NOT NULL CHECK(status IN ('pending','delivered','failed')),attempts integer NOT NULL DEFAULT 0,next_at timestamptz NOT NULL DEFAULT now(),lease_until timestamptz,last_status integer,created_at timestamptz NOT NULL DEFAULT now(),delivered_at timestamptz);
 CREATE INDEX webhook_deliveries_due ON webhook_deliveries(next_at) WHERE status='pending';
 CREATE INDEX webhook_deliveries_project ON webhook_deliveries(project_id,created_at DESC);
 INSERT INTO migrations(version) VALUES(11);`;
      for (const statement of sql.split(";").filter((s) => s.trim()))
        await tx.query(statement);
    }
    if (!(await tx.one("SELECT version FROM migrations WHERE version=12"))) {
      await tx.query(`CREATE TABLE documents(
        id uuid PRIMARY KEY,
        project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        object_key text NOT NULL UNIQUE,
        data jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
      await tx.query(
        "CREATE INDEX documents_project ON documents(project_id,created_at DESC)",
      );
      await tx.query(
        "CREATE INDEX threads_document ON threads(project_id,((data->'context'->'document'->>'id')),(((data->'context'->'document'->>'page')::integer)),created_at DESC,id DESC) WHERE data->'context'->'document' IS NOT NULL",
      );
      await tx.query("INSERT INTO migrations(version) VALUES(12)");
    }
  });
}
