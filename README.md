# Bird Whisperer

Daily Twitter digest delivered to your inbox. Stay informed about specific accounts without doomscrolling.

## Architecture

```
Local Machine                          Cloudflare Worker
──────────────────                      ──────────────────
Cron (every 2h)                         daily at 8am NYC
   │                                        │
   ↓                                        ↓
sync-cookies.sh ──cookies─────────────►│ Cloudflare Secrets
   │                                    │
Chrome ──cookies──┘                     ↓
                                      reads config.yaml
                                      filter tweets to last 24h
                                      dedupe with KV Namespace
                                              ↓
                                        fetch tweets → X
                                        summarize → Gemini (markdown)
                                        convert to HTML (marked)
                                        add inline footnote links
                                        send email → Resend
```

**Why this design?**

- Your laptop provides fresh X cookies (required since X uses cookie auth)
- Cloudflare Worker runs reliably on a schedule (no laptop needed)
- KV deduplication prevents duplicate emails
- Only new tweets from the last 24 hours are fetched and summarized
- Summaries are rendered as HTML with inline footnote links to original tweets

## Quick Start

### Prerequisites

- [pnpm](https://pnpm.io/installation)
- [Cloudflare Wrangler](https://developers.cloudflare.com/wrangler/install)
- Chromium logged into X (x.com)
- API keys: [Gemini](https://aistudio.google.com/app/apikey) + [Resend](https://resend.com/api-keys)

### Setup

```bash
# 1. Enter project
cd bird-whisperer

# 2. Copy config files
cp wrangler.example.toml wrangler.toml
cp config.example.yaml config.yaml

# 3. Edit config.yaml with your users and follows
# Edit wrangler.toml with your KV namespace ID (run: pnpm run kv:create)

# 4. Set required secrets (one at a time, wrangler prompts for each value)
wrangler secret put AUTH_TOKEN
wrangler secret put CT0
wrangler secret put GEMINI_API_KEY
wrangler secret put RESEND_API_KEY

# 5. Deploy worker
pnpm run deploy

# 6. Setup cron (every 2 hours)
crontab -e
# Add: 0 */2 * * * /path/to/bird-whisperer/scripts/sync-cookies.sh
```

## Configuration

### config.yaml (DO NOT COMMIT)

Copy `config.example.yaml` to `config.yaml` and edit:

```yaml
users:
  - email: person@example.com           # single address
    context: "I work at Shopify. I'm interested in AI/ML infrastructure, e-commerce, and building great products."
    follows:
      - username: tobi
      - username: harleyf
  - email:                               # or a list of addresses
      - person@example.com
      - partner@example.com
    context: "We're interested in AI..."
    follows:
      - username: samaltman

llm:
  provider: google
  model: gemini-3-flash-preview

prompt: |
  You are writing a section of a personalized newsletter digest...
  # See config.example.yaml for the full default prompt
```

**Never commit `config.yaml`** — it contains personal email addresses and context.

### wrangler.toml (DO NOT COMMIT)

Copy `wrangler.example.toml` to `wrangler.toml` and edit:

```toml
name = "bird-whisperer"
compatibility_date = "2026-01-01"
compatibility_flags = ["nodejs_compat"]
main = "src/index.ts"

[[rules]]
type = "Text"
globs = ["**/*.yaml"]
fallthrough = true

[[kv_namespaces]]
binding = "BIRD_WHISPERER"
id = "YOUR_KV_ID"  # Run: pnpm run kv:create

[triggers]
crons = ["0 13 * * *"]  # Daily at 1pm UTC (8am NYC/EST)

[observability]
[observability.logs]
enabled = true
invocation_logs = true
```

**Never commit `wrangler.toml`** — it contains your KV namespace ID.

### Adding Users and Follows

Edit `config.yaml`. The `email` field accepts a single address or a list — all recipients share the same digest, context, and follows:

```yaml
users:
  - email: person@example.com
    context: "I work at Shopify..."
    follows:
      - username: tobi
      - username: harleyf
  - email:
      - me@example.com
      - partner@example.com
    context: "We're interested in AI..."
    follows:
      - username: samaltman
```

**Scaling Limits:** Cloudflare Workers have a 15-minute timeout for scheduled triggers. Per follow, the worker makes:
- **2 API calls to X (Twitter)** - resolve username + fetch tweets
- 1 API call to Gemini (LLM summarization)

Plus per user (each recipient if `email` is a list):
- 1 email send via Resend per address

**Example:** 5 users × 5 follows = 50 Twitter calls + 25 Gemini calls + 5 emails. With 50 tweets per follow, fetching all tweets can take significant time.

**Recommended limits:** ~5 users with ~5 follows each (25 follows total) to stay within 15-minute timeout. Scale horizontally by running multiple workers with different configs if needed.

### Custom Prompt

Edit the `prompt` field in `config.yaml` to customize how summaries are generated. The default prompt instructs the LLM to:

- Write in a conversational newsletter tone (not bullet points or dry lists)
- Scale length proportionally to tweet count (1-2 tweets = 2-3 sentences; 6+ = 2 short paragraphs)
- Reference specific tweets using `[1]`, `[2]` notation (converted to clickable links in the email)
- Avoid common AI writing patterns (inflated language, forced metaphors, filler phrases)

### Changing LLM Model

```yaml
llm:
  provider: google
  model: gemini-3-flash-preview  # or other Google models
```

### Cron Frequency

Edit crontab (`0 */2 * * *`):

| Frequency | Crontab |
|-----------|---------|
| Every 2 hours | `0 */2 * * *` |
| Every 6 hours | `0 */6 * * *` |
| Every hour | `0 * * * *` |

### Manual Trigger

To manually trigger a digest (useful for testing or if cron failed):

```bash
# Enable trigger endpoint
pnpm run trigger:enable

# Trigger manually
pnpm run trigger

# Disable trigger endpoint (default state)
pnpm run trigger:disable
```

**Security:** The `/trigger` endpoint is only active when the `ENABLE_MANUAL_TRIGGER` secret is set to `true`. Use `pnpm run trigger:disable` to set it back to `false` when done.

### Resetting KV State

To clear all stored state (last seen tweet IDs and sent flags) and force a fresh digest:

```bash
pnpm run kv:reset
```

This reads the KV namespace ID from `wrangler.toml` and deletes all keys from the remote namespace.

## Email Format

Users receive one consolidated HTML digest email per day. Summaries are rendered from markdown with inline footnote links to original tweets:

```
🐦 Bird Whisperer Digest
February 1, 2026

@tobi
They've been focused on AI infrastructure this week, sharing thoughts
on PyTorch's JIT deprecation [1] and a new approach to small MLPs [2].
The frustration with the framework direction [1] echoes wider concerns
in the production ML community.
5 new tweets

@harleyf
They shared a personal moment — a couple celebrating 70 years of
marriage [1].
1 new tweet

---
Powered by Bird Whisperer
```

Each `[N]` in the summary links directly to the corresponding tweet on X.

## How It Works

### Cookie Sync

1. `sync-cookies.sh` extracts `auth_token` and `ct0` from Chromium
2. Uploads to Cloudflare as secrets
3. Runs every 2 hours to ensure fresh cookies

### Daily Digest

1. Worker triggers at 8am NYC (1pm UTC)
2. For each user, fetches tweets and filters to the last 24 hours
3. Deduplicates against last seen tweet ID (stored in KV)
4. Summarizes new tweets via Gemini with the user's context (quote tweet content is included inline)
5. Converts markdown summary to HTML via `marked`
6. Replaces `[N]` footnote references with links to the original tweets
7. Sends one consolidated email per user
8. Stores newest tweet ID to avoid re-fetching on next run

### Deduplication

- **Time-based:** Tweets older than 24 hours are dropped before processing
- **ID-based:** Per-follow last seen tweet ID tracked (`lastSeen:{email}:{username}`)
- **Per-user:** Digest sent once per day (`sent:{date}:{email}`)
- Only tweets passing both filters are summarized

## Troubleshooting

### Cookies not syncing

```bash
# Verify chromium path
echo $HOME/.config/chromium/Default

# Run with debug
./scripts/sync-cookies.sh
```

### No tweets returned

```bash
# Check cookies are valid
pnpm exec bird check --cookie-source chrome --chrome-profile-dir $HOME/.config/chromium/Default
```

### Worker errors

```bash
# View live logs
wrangler tail
```

## Files

```
bird-whisperer/
├── wrangler.example.toml    # Example worker config (copy to wrangler.toml)
├── wrangler.toml            # Your worker config (NOT committed)
├── package.json             # Dependencies & scripts
├── tsconfig.json            # TypeScript config
├── config.example.yaml      # Example config (copy to config.yaml)
├── config.yaml              # Your config (NOT committed)
├── src/
│   ├── index.ts             # Worker entry point, handlers
│   ├── config.ts            # YAML config loading + Zod validation
│   ├── twitter.ts           # Twitter API client
│   ├── email.ts             # SMTP client (nodemailer)
│   ├── summarize.ts         # LLM client (Google AI)
│   └── yaml.d.ts            # Type declarations for YAML imports
├── scripts/
│   ├── sync-cookies.sh      # Cookie extraction + upload to Cloudflare secrets
│   ├── kv-reset.sh          # Delete all keys from remote KV namespace
│   └── extract-cookies.mjs  # Extract cookies from Chrome profile
└── README.md
```

**Note:** `config.yaml` and `wrangler.toml` are gitignored — copy from the `.example` files and customize.

## License

MIT
