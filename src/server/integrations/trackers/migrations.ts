export const trackerMigrationSql = `
CREATE TABLE tracker_connections(
 id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id),provider text NOT NULL,label text NOT NULL,
 configuration jsonb NOT NULL,credential_key text NOT NULL,credential jsonb NOT NULL,
 revision integer NOT NULL DEFAULT 1,enabled boolean NOT NULL DEFAULT true,health text NOT NULL DEFAULT 'unchecked',
 error_code text,checked_at timestamptz,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX tracker_connections_project ON tracker_connections(project_id);
CREATE TABLE tracker_links(
 id uuid PRIMARY KEY,connection_id uuid NOT NULL REFERENCES tracker_connections(id),thread_id uuid NOT NULL REFERENCES threads(id),
 remote_id text NOT NULL,url text NOT NULL,title text NOT NULL,remote_state text NOT NULL,observed_remote_state text,local_state text NOT NULL,
 local_revision integer NOT NULL,status text NOT NULL DEFAULT 'synced',checked_at timestamptz,next_poll_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(connection_id,thread_id,remote_id));
CREATE INDEX tracker_links_poll ON tracker_links(next_poll_at);
CREATE TABLE tracker_jobs(
 id uuid PRIMARY KEY,connection_id uuid NOT NULL REFERENCES tracker_connections(id),connection_revision integer NOT NULL,
 thread_id uuid NOT NULL REFERENCES threads(id),kind text NOT NULL,payload jsonb NOT NULL,actor jsonb NOT NULL,
 idempotency_key text NOT NULL,input_hash text NOT NULL,status text NOT NULL DEFAULT 'pending',attempts integer NOT NULL DEFAULT 0,
 error_code text,remote_id text,created_at timestamptz NOT NULL DEFAULT now(),next_at timestamptz NOT NULL DEFAULT now(),lease_until timestamptz,
 UNIQUE(connection_id,idempotency_key));
CREATE INDEX tracker_jobs_due ON tracker_jobs(next_at) WHERE status='pending';
CREATE TABLE tracker_oauth_flows(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id),session_hash text NOT NULL,project_id uuid NOT NULL REFERENCES projects(id),provider text NOT NULL,payload jsonb NOT NULL,credential_key text NOT NULL,credential jsonb NOT NULL,expires_at timestamptz NOT NULL,consumed_at timestamptz);
`;
