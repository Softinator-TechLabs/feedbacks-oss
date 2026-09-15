import { Pool } from "pg";
export interface Queryable {
  query(sql: string, params?: any[]): Promise<{ rows: any[] }>;
}
export class Database {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(public readonly connection: Queryable & { connect?: () => Promise<any> }) {}
  async query(sql: string, params: any[] = []) {
    return (await this.connection.query(sql, params)).rows;
  }
  async one(sql: string, params: any[] = []) {
    return (await this.query(sql, params))[0];
  }
  async transaction<T>(work: (tx: Database) => Promise<T>): Promise<T> {
    const run = async () => {
      const client = this.connection.connect
        ? await this.connection.connect()
        : this.connection;
      const tx = new Database(client);
      await tx.query("BEGIN");
      try {
        const result = await work(tx);
        await tx.query("COMMIT");
        return result;
      } catch (error) {
        await tx.query("ROLLBACK");
        throw error;
      } finally {
        if ("release" in client) client.release();
      }
    };
    if (this.connection.connect) return run();
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }
}
export function postgres(url: string, max = 10) {
  return new Database(
    new Pool({
      connectionString: url,
      max,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
      statement_timeout: 30000,
      lock_timeout: 10000,
    }),
  );
}
