import config from "virtual:brim/config";
import type { Database } from "../db/database.ts";
import { type QueryRules, QueryReads, composeQueryRules } from "../server/query-params.ts";

let reads: QueryReads | undefined;

/** What the pages of this build were seen reading, one store for the process (the pages and /admin share it). */
export function queryReads(db: Database): QueryReads {
  reads ??= new QueryReads(db, config.build);
  return reads;
}

/** The `query` /admin/api/info answers: the config's declarations and what pages were seen reading. */
export async function siteQueryRules(db: Database): Promise<QueryRules> {
  return composeQueryRules(config.query ?? {}, await queryReads(db).learned());
}
