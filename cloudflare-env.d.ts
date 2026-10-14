declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    AI_SECRET_ENCRYPTION_KEY?: string;
  }
}
