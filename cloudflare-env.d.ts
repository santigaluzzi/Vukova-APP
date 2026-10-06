declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    VUKOVA_SETUP_TOKEN_SHA256?: string;
    VUKOVA_IMPORT_TOKEN_SHA256?: string;
    VUKOVA_IMPORT_EXPIRES_AT?: string;
    BUCKET?: R2Bucket;
  }
}
