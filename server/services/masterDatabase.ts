/**
 * Application-facing port for master database access used by legacy adapters.
 *
 * Keeping this seam outside HTTP routes prevents transport code from depending
 * on the compatibility database facade. Feature migrations can replace calls
 * through this port with focused repositories without changing route contracts.
 */
export {
  masterQuery,
  masterTransaction,
  pool,
  query,
  transaction,
} from "../db";