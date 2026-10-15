// Worker binding types — kept in sync with wrangler.jsonc
// Run `npx wrangler types` after updating wrangler.jsonc to regenerate
interface Env {
  DB: D1Database
  BUCKET: R2Bucket
}
