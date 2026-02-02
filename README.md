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
                                      dedupe with KV Namespace
                                              ↓
                                        fetch tweets → X
                                        summarize → Gemini
                                        send email → Resend
```

**Why this design?**

- Your laptop provides fresh X cookies (required since X uses cookie auth)
- Cloudflare Worker runs reliably on a schedule (no laptop needed)
- KV deduplication prevents duplicate emails
- Only new tweets are fetched and summarized each day

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

# 4. Set required secrets
wrangler secret put AUTH_TOKEN CT0 GEMINI_API_KEY RESEND_API_KEY

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
  - email: person@example.com
    context: "I work at Shopify. I'm interested in AI/ML infrastructure, e-commerce, and building great products."
    follows:
      - username: tobi
      - username: harleyf
      - username: vlaurenlee
      - username: MParakhin

llm:
  provider: google
  model: gemini-3-flash-preview

prompt: |
  You are helping someone stay informed about a Twitter user's activity.
  ...
```

**Never commit `config.yaml`** — it contains personal email addresses and context.

### wrangler.toml (DO NOT COMMIT)

Copy `wrangler.example.toml` to `wrangler.toml` and edit:

```toml
name = "bird-whisperer"
compatibility_date = "2026-01-01"
main = "src/index.ts"

compatibility_flags = ["nodejs_compat"]

[[kv_namespaces]]
binding = "BIRD_WHISPERER"
id = "YOUR_KV_ID"  # Run: pnpm run kv:create

[triggers]
crons = ["0 13 * * *"]  # Daily at 1pm UTC (8am NYC/EST)
```

**Never commit `wrangler.toml`** — it contains your KV namespace ID.

### Adding Users and Follows

Edit `config.yaml`:

```yaml
users:
  - email: person@example.com
    context: "I work at Shopify..."
    follows:
      - username: tobi
      - username: harleyf
  - email: me@example.com
    context: "I'm interested in AI..."
    follows:
      - username: samaltman
```

### Custom Prompt

Edit the `prompt` field in `config.yaml` to customize how summaries are generated.

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

To manually trigger a digest (useful if cron failed):

```bash
# Enable trigger endpoint
pnpm run trigger:enable

# Trigger manually
pnpm run trigger

# Disable trigger endpoint (default state)
pnpm run trigger:disable
```

**Security:** The `/trigger` endpoint is only active when `ENABLE_MANUAL_TRIGGER=true`. The TOML defaults to `false` so every deploy resets it.

## Email Format

Users receive one consolidated digest email per day:

```
🐦 Bird Whisperer Digest
February 1, 2026

@tobi
Summary of what tobi tweeted about...
5 new tweets
- View tweet
- View tweet
- View tweet

@harleyf
Summary of harleyf's tweets...
2 new tweets
- View tweet
- View tweet

---
Powered by Bird Whisperer
```

## How It Works

### Cookie Sync

1. `sync-cookies.sh` extracts `auth_token` and `ct0` from Chromium
2. Uploads to Cloudflare as secrets
3. Runs every 2 hours to ensure fresh cookies

### Daily Digest

1. Worker triggers at 8am NYC (1pm UTC)
2. For each user, fetches only new tweets (tracks last seen via KV `maxId`)
3. Summarizes new tweets via Gemini with the user's context
4. Sends one consolidated email per user
5. Stores `maxId` to avoid re-fetching on next run

### Deduplication

- Per-user digest sent once per day (`sent:{date}:{email}`)
- Per-follow max tweet ID tracked (`maxId:{email}:{username}`)
- Only new tweets since last run are fetched and summarized

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
├── wrangler.example.toml   # Example worker config (copy to wrangler.toml)
├── wrangler.toml           # Your worker config (NOT committed)
├── package.json            # Dependencies & scripts
├── tsconfig.json           # TypeScript config
├── config.example.yaml     # Example config (copy to config.yaml)
├── config.yaml             # Your config (NOT committed)
├── architecture.svg        # Architecture diagram
├── src/
│   └── index.ts            # Worker entry point
├── scripts/
│   └── sync-cookies.sh     # Cookie extraction script
└── README.md
```

**Note:** `config.yaml` and `wrangler.toml` are gitignored — copy from the `.example` files and customize.

## License

MIT
