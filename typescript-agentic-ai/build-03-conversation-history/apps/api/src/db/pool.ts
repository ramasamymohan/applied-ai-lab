/**
 * PostgreSQL connection pool.
 *
 * Creates a single shared Pool instance using DATABASE_URL. The pool is
 * registered as a Fastify plugin so it participates in the application
 * lifecycle — the pool is closed automatically when the server shuts down.
 *
 * Usage:
 *   await app.register(databasePlugin, { databaseUrl });
 *   const pool = app.pg; // Pool
 */

import pg from "pg";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";

const { Pool } = pg;
export type { Pool } from "pg";

declare module "fastify" {
  interface FastifyInstance {
    pg: pg.Pool;
  }
}

type DatabasePluginOptions = {
  databaseUrl: string;
};

const databasePluginImpl: FastifyPluginAsync<DatabasePluginOptions> = async (
  app: FastifyInstance,
  options: DatabasePluginOptions,
) => {
  const pool = new Pool({
    connectionString: options.databaseUrl,
    // Sensible defaults for a single-instance dev/staging server
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  // Verify database connectivity at registration time
  try {
    const client = await pool.connect();
    client.release();
    app.log.info("PostgreSQL pool connected");
  } catch (err) {
    app.log.error({ err }, "Failed to connect to PostgreSQL");
    throw err;
  }

  app.decorate("pg", pool);

  app.addHook("onClose", async () => {
    app.log.info("Closing PostgreSQL pool");
    await pool.end();
  });
};

export const databasePlugin = fp(databasePluginImpl, {
  name: "database",
});
