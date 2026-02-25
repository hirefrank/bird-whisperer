# AGENTS.md - Bird Whisperer

## Build Commands

```bash
# Type checking (run before committing)
pnpm run typecheck

# Development with remote Cloudflare bindings
pnpm run dev

# Deploy to production
pnpm run deploy

# KV namespace setup (one-time)
pnpm run kv:create

# Reset all remote KV state (lastSeen + sent flags)
pnpm run kv:reset

# Push local YAML config to CONFIG_YAML secret
pnpm run config:push

# Manual trigger controls
pnpm run trigger:enable   # Enable /trigger endpoint
pnpm run trigger:disable  # Disable /trigger endpoint
WORKER_URL=https://your-worker.workers.dev pnpm run trigger  # Execute manual trigger
```

## Development Environment

**All development is remote** — no local infrastructure is used. The `pnpm run dev` command runs with `--remote` flag, which means:
- Uses remote Cloudflare Workers runtime (not local Miniflare)
- Connects to remote KV namespace for state
- Requires active internet connection
- Tests against real external APIs (X, Gemini, Resend/Cloudflare Email Service)

This ensures dev matches production exactly, but means you need:
- Valid secrets configured in Cloudflare (`X_BEARER_TOKEN`, `GEMINI_API_KEY`, and optional `RESEND_API_KEY`)
- Active API keys for X API and Gemini, plus one email provider (Resend or Cloudflare Email Service)

## Code Style Guidelines

### TypeScript Configuration
- **Target**: ES2022 with ESNext modules
- **Module Resolution**: Bundler (for Cloudflare Workers)
- **Strict Mode**: Enabled - all strict compiler options on
- **Types**: `@cloudflare/workers-types` for Worker globals

### Imports & Module Structure
- Use ES modules (`"type": "module"` in package.json)
- Import order: external deps → internal modules → types
- Always include `.js` extension in local imports: `import { foo } from './bar.js'`
- Use `type` imports for types: `import type { Config } from './config.js'`

### Formatting & Naming
- **Indentation**: 2 spaces
- **Quotes**: Single quotes for strings, backticks for templates
- **Semicolons**: Omit (project style)
- **Functions**: Use function expressions with explicit return types
  ```typescript
  export function loadConfig(): Config { }
  ```
- **Interfaces**: PascalCase, prefixed with type purpose
  ```typescript
  export interface EmailClient { }
  ```
- **Types**: Use `type` aliases for derived types, `interface` for shapes

### Type Safety
- Use Zod for runtime validation (see `config.ts`)
- Infer types from schemas: `export type Config = z.infer<typeof ConfigSchema>`
- Avoid `any` - use `unknown` with type guards
- Explicit return types on all exported functions
- Use `satisfies` for handler exports: `satisfies ExportedHandler<Env>`

### Error Handling
- Throw descriptive errors with context
- Use try/catch at boundaries (external API calls, file operations)
- Log errors with `console.error` before returning fallbacks
- Validate external data with Zod before use

### Cloudflare Workers Specifics
- Access env vars via `env` object, not `process.env`
- KV operations are async: `await env.BIRD_WHISPERER.get(key)`
- Use `[[rules]]` in wrangler.toml to bundle non-JS assets (YAML, etc.)
- Set `compatibility_flags = ["nodejs_compat"]` for Node.js APIs

### Secrets Management
- Store secrets via Wrangler CLI, not in code:
  ```bash
  wrangler secret put SECRET_NAME
  ```
- Define secret types in `Env` interface in `index.ts`
- Never commit secrets or config files with real data

### Configuration
- Use YAML for human-editable config (bundled via wrangler rules)
- Runtime config can be overridden by `CONFIG_YAML` secret (takes precedence over bundled `config.yaml`)
- `wrangler.toml` is committed as a template for Deploy-to-Cloudflare button flow; keep personal values in `wrangler.local.toml`
- Add TypeScript declarations for non-standard imports (see `yaml.d.ts`)
- Validate config at load time with Zod schemas

### Dependencies
- Use `require()` for optional/lazy-loaded deps in factory functions
- Keep core deps minimal; prefer built-in Worker APIs
- Pin wrangler to major version: `"wrangler": "4"`

### Testing
- **No test framework currently configured**
- To add testing, consider: Vitest with `wrangler-vitest-integration`
- Manual testing via: `pnpm run dev` + `WORKER_URL=... pnpm run trigger`

### Pre-Commit Checklist
1. Run `pnpm run typecheck` - must pass
2. Verify no secrets in code
3. Test manual trigger if changing core logic
4. Ensure `config.example.yaml` is updated if schema changes

### Project Structure
```
src/
  index.ts            # Worker entry point, handlers, X API v2 client
  config.ts           # YAML config loading + validation
  yaml.d.ts           # Type declarations for YAML imports
scripts/
  kv-reset.sh         # Delete all keys from remote KV namespace
  push-config-secret.sh # Push config YAML into CONFIG_YAML secret
  trigger.mjs         # Invoke /trigger endpoint via WORKER_URL
```

### Key Architectural Patterns
- **Factory functions**: `createTwitterClient()` and provider factories return interface-implementing objects
- **Cron-triggered**: Worker runs on schedule via `[triggers]` in wrangler.toml
- **KV-backed**: State persisted in Cloudflare KV (last seen IDs, sent flags)
- **Lazy loading**: Heavy deps loaded via `require()` inside functions, not at top
- **Aggregate insights block**: optional cross-follow trend summary is generated when 2+ follows have fresh tweets

### Scaling & Performance
- **15-minute timeout** for scheduled triggers on Cloudflare Workers
- Each follow requires: 1 X API call (user tweets) + 1 Gemini API call (userId cached in KV after first lookup)
- Each user may add: 1 extra Gemini API call for aggregate insights across follows
- Each user requires: 1 email send via configured provider (Resend or Cloudflare Email Service)
- **Recommended:** Max ~5 users with ~5 follows each (25 total follows) to stay within timeout
- Consider queue-based architecture with Durable Objects if scaling beyond this
