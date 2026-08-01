import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// No incremental cache override: the demo has exactly one dynamic page and one
// API route, so there is nothing worth caching in R2. Add
// `incrementalCache: r2IncrementalCache` here if that changes.
export default defineCloudflareConfig();
