export interface Env {
  BIRD_WHISPERER: KVNamespace;
  ASSETS: Fetcher;
  X_BEARER_TOKEN: string;
  GEMINI_API_KEY: string;
  RESEND_API_KEY?: string;
  EMAIL_PROVIDER?: string;
  EMAIL_FROM?: string;
  EMAIL_REPLY_TO?: string;
  EMAIL?: SendEmail;
  CONFIG_YAML?: string;
  ENABLE_MANUAL_TRIGGER?: string;
}

import { loadConfig, type Config } from './config'
import { marked } from 'marked'

const TWITTER_BLUE = '#1da1f2'
const DEFAULT_FROM = 'Bird Whisperer <noreply@notifications.hirefrank.com>'

type EmailProvider = 'cloudflare' | 'resend'

interface EmailClient {
  send(to: string, subject: string, html: string): Promise<void>
}

function fillPromptTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{([A-Z_]+)\}/g, (match, key) => {
    return key in values ? values[key] : match
  })
}

function linkFollowedMentionsInHtml(html: string, followedHandles: Set<string>): string {
  return html.replace(/<a\b[^>]*>[\s\S]*?<\/a>|@([A-Za-z0-9_]{1,15})/gi, (match, username?: string) => {
    if (!username) return match

    if (!followedHandles.has(username.toLowerCase())) {
      return match
    }

    return `<a href="https://x.com/${username}" style="color: ${TWITTER_BLUE}; text-decoration: none; font-weight: 600;">@${username}</a>`
  })
}

// X API v2 response types
interface XApiTweet {
  id: string
  text: string
  author_id?: string
  created_at?: string
  public_metrics?: {
    retweet_count: number
    reply_count: number
    like_count: number
    quote_count: number
  }
  referenced_tweets?: Array<{
    type: 'retweeted' | 'quoted' | 'replied_to'
    id: string
  }>
}

interface XApiUser {
  id: string
  username: string
  name: string
}

interface XApiProblem {
  title?: string
  detail?: string
  message?: string
  type?: string
  status?: number
}

interface XApiTweetsResponse {
  data?: XApiTweet[]
  includes?: {
    tweets?: XApiTweet[]
    users?: XApiUser[]
  }
  meta?: {
    result_count: number
    next_token?: string
    newest_id?: string
    oldest_id?: string
  }
  errors?: XApiProblem[]
}

interface XApiUserResponse {
  data?: {
    id: string
    username: string
    name: string
  }
  errors?: XApiProblem[]
}

function formatXApiErrors(errors: XApiProblem[] | undefined): string {
  if (!errors?.length) return 'Unknown X API error'

  return errors
    .map((problem) => problem.detail || problem.title || problem.message || 'Unknown X API error')
    .join(' | ')
}

interface NormalizedTweet {
  id: string
  text: string
  createdAt?: string
  replyCount?: number
  retweetCount?: number
  likeCount?: number
  quotedTweet?: {
    text: string
    author?: { username: string }
  }
}

function createTwitterClient(bearerToken: string) {
  const baseUrl = 'https://api.x.com/2'
  const headers = { Authorization: `Bearer ${bearerToken}` }

  return {
    async getUserIdByUsername(username: string): Promise<{ success: boolean; userId?: string; error?: string }> {
      try {
        const resp = await fetch(`${baseUrl}/users/by/username/${encodeURIComponent(username)}`, { headers })
        if (!resp.ok) {
          const body = await resp.text()
          return { success: false, error: `HTTP ${resp.status}: ${body}` }
        }

        const body = await resp.json() as XApiUserResponse
        if (body.errors?.length) {
          return { success: false, error: formatXApiErrors(body.errors) }
        }
        if (!body.data?.id) {
          return { success: false, error: 'User not found' }
        }
        return { success: true, userId: body.data.id }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[getUserIdByUsername] Failed to resolve @${username}: ${message}`)
        return { success: false, error: `Request failed: ${message}` }
      }
    },

    async getUserTweets(
      userId: string,
      options: { maxResults?: number; sinceId?: string; startTime?: string } = {}
    ): Promise<NormalizedTweet[]> {
      try {
        const params = new URLSearchParams({
          max_results: String(options.maxResults || 20),
          'tweet.fields': 'created_at,public_metrics,referenced_tweets,author_id',
          expansions: 'referenced_tweets.id,referenced_tweets.id.author_id',
          'user.fields': 'username,name',
        })
        if (options.sinceId) params.set('since_id', options.sinceId)
        if (options.startTime) params.set('start_time', options.startTime)

        const resp = await fetch(`${baseUrl}/users/${encodeURIComponent(userId)}/tweets?${params}`, { headers })
        if (!resp.ok) {
          const body = await resp.text()
          console.error(`Failed to fetch tweets for user ${userId}: HTTP ${resp.status}: ${body}`)
          return []
        }

        const body = await resp.json() as XApiTweetsResponse
        if (body.errors?.length) {
          console.error(`[getUserTweets] X API returned errors for user ${userId}: ${formatXApiErrors(body.errors)}`)
        }
        if (!body.data) return []

        // Build lookup maps for included tweets and users
        const includedTweets = new Map<string, XApiTweet>()
        const includedUsers = new Map<string, XApiUser>()
        if (body.includes?.tweets) {
          for (const t of body.includes.tweets) includedTweets.set(t.id, t)
        }
        if (body.includes?.users) {
          for (const u of body.includes.users) includedUsers.set(u.id, u)
        }

        return body.data.map((tweet): NormalizedTweet => {
          const quotedRef = tweet.referenced_tweets?.find(r => r.type === 'quoted')
          let quotedTweet: NormalizedTweet['quotedTweet']
          if (quotedRef) {
            const qt = includedTweets.get(quotedRef.id)
            if (qt) {
              const qtAuthor = qt.author_id ? includedUsers.get(qt.author_id) : undefined
              quotedTweet = {
                text: qt.text,
                author: qtAuthor ? { username: qtAuthor.username } : undefined,
              }
            }
          }

          return {
            id: tweet.id,
            text: tweet.text,
            createdAt: tweet.created_at,
            replyCount: tweet.public_metrics?.reply_count,
            retweetCount: tweet.public_metrics?.retweet_count,
            likeCount: tweet.public_metrics?.like_count,
            quotedTweet,
          }
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[getUserTweets] Failed to fetch tweets for user ${userId}: ${message}`)
        return []
      }
    },
  }
}

function createLlmClient(model: string, apiKey: string, customPrompt: string | undefined) {
  const { createGoogleGenerativeAI } = require('@ai-sdk/google');
  const { generateText } = require('ai');

  const google = createGoogleGenerativeAI({ apiKey });
  const prompt = customPrompt || `You are writing a section of a personalized newsletter digest about a Twitter user's recent activity.

Context about the reader: {CONTEXT}

Here are the user's recent tweets, numbered for reference:
{TWEETS}

Write a short, sharp summary. Reference specific tweets using [1], [2], etc. — these become clickable links. The reader's context is provided for background — use it to add color when relevant, but don't dismiss or skip tweets just because they're off-topic. Summarize what the person is actually talking about.

Always refer to the person as "they/them" — never guess their real name, and never say "the user."

Length rules:
- 1-2 tweets: 2-3 sentences max. Don't pad thin content.
- 3-5 tweets: 1 short paragraph.
- 6+ tweets: 2 short paragraphs. No more.

Never inflate a single tweet into multiple paragraphs.

Style rules:
- Write like a sharp friend catching you up over coffee, not a blog post or analyst report.
- Use plain, direct language. Say "is" not "serves as." Say "shows" not "is a testament to."
- No bullet points or numbered lists. Flowing prose only.
- NEVER use these words/phrases: "landscape," "testament," "tapestry," "delve," "groundbreaking," "compelling," "crucial," "vital," "pivotal," "showcases," "underscores," "broader trends," "it's worth noting," "in an era where," "interplay," "foster," "intricacies."
- Don't use "Not only...but also" or "It's not just...it's" constructions.
- Don't start paragraphs with "In a..." or "In the context of..."
- Avoid forced metaphors connecting personal tweets to the reader's work domain. A tweet about someone's marriage doesn't need to be about "building durable infrastructure."
- Be concrete. If you reference a tweet's topic, say what it actually says.`;

  const aggregatePrompt = `You are analyzing tweets from multiple Twitter accounts to identify shared conversations and trending topics across a reader's follows.

Context about the reader: {CONTEXT}

Here are recent tweets grouped by account:

{GROUPED_TWEETS}

Identify topics, events, or conversations that 2 or more accounts are discussing. A shared topic means multiple people are reacting to, commenting on, or referencing the same underlying thing — a viral tweet, news event, product launch, shared link, etc.

If you find shared topics, write a brief trending section. For each shared topic:
- Bold the topic name
- Mention which @handles are discussing it (use @username format)
- Summarize what they're collectively saying in 1-2 sentences
- If handles have notably different takes, note the contrast

Rules:
- Only surface topics that genuinely appear across 2+ accounts. Don't force connections.
- If accounts are directly replying to or quoting each other about the same thing, that's a strong signal.
- 1-3 shared topics max. Quality over quantity.
- Same style rules as individual summaries: plain, direct, no filler words.
- Do NOT use [N] tweet references — this is a high-level cross-account view.
- Use flowing prose, not bullet points.

If there are no meaningful shared topics across accounts, respond with exactly and only: NO_SHARED_TOPICS`

  return {
    async summarize(tweets: NormalizedTweet[], context: string, twitterUsername: string): Promise<{ summary: string; links: string[]; tweetCount: number }> {
      const tweetText = tweets
        .map((t, i) => {
          let line = `[${i + 1}] ${t.text}`
          if (t.quotedTweet?.text) {
            const author = t.quotedTweet.author?.username ? `@${t.quotedTweet.author.username}` : 'unknown'
            line += `\n    ↳ Quoted ${author}: "${t.quotedTweet.text}"`
          }
          return line
        })
        .join('\n\n');

      const links = tweets.map((t) => `https://x.com/${twitterUsername}/status/${t.id}`);

      const { text } = await generateText({
        model: google(model),
        prompt: fillPromptTemplate(prompt, {
          CONTEXT: context,
          TWEETS: tweetText,
        }),
        system: 'You write concise, natural-sounding newsletter summaries. You never pad content or use filler phrases. You sound like a person, not an AI.',
      });

      return { summary: text, links, tweetCount: tweets.length };
    },

    async aggregateTopics(handleTweets: { username: string; tweets: NormalizedTweet[] }[], context: string): Promise<string> {
      const groupedText = handleTweets
        .map((h) => {
          const tweets = h.tweets
            .map((t) => {
              let line = `- ${t.text}`
              if (t.quotedTweet?.text) {
                const author = t.quotedTweet.author?.username ? `@${t.quotedTweet.author.username}` : 'unknown'
                line += `\n  ↳ Quoted ${author}: "${t.quotedTweet.text}"`
              }
              return line
            })
            .join('\n')
          return `@${h.username}:\n${tweets}`
        })
        .join('\n\n')

      const { text } = await generateText({
        model: google(model),
        prompt: fillPromptTemplate(aggregatePrompt, {
          CONTEXT: context,
          GROUPED_TWEETS: groupedText,
        }),
        system: 'You write concise, natural-sounding newsletter summaries. You never pad content or use filler phrases. You sound like a person, not an AI.',
      })

      if (text.trim() === 'NO_SHARED_TOPICS') {
        return ''
      }

      return text
    },
  };
}

function getEmailProvider(env: Env): EmailProvider {
  const configuredProvider = env.EMAIL_PROVIDER?.trim().toLowerCase()
  if (configuredProvider === 'cloudflare' || configuredProvider === 'resend') {
    return configuredProvider
  }

  if (configuredProvider) {
    throw new Error(`Unsupported EMAIL_PROVIDER '${env.EMAIL_PROVIDER}'. Expected 'resend' or 'cloudflare'.`)
  }

  if (env.RESEND_API_KEY) {
    return 'resend'
  }

  if (env.EMAIL) {
    return 'cloudflare'
  }

  throw new Error('No email provider configured. Set RESEND_API_KEY or bind EMAIL (Cloudflare Email Service).')
}

function createCloudflareEmailClient(
  emailBinding: SendEmail,
  from: string,
  replyTo: string | undefined,
): EmailClient {
  return {
    async send(to: string, subject: string, html: string): Promise<void> {
      try {
        // SendEmail.send() throws on failure; EmailSendResult only has messageId
        const result = await emailBinding.send({
          from,
          to,
          subject,
          html,
          ...(replyTo ? { replyTo } : {}),
        })
        console.log(`Email sent via Cloudflare, messageId: ${result.messageId}`)
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        throw new Error(`Cloudflare Email Service error: ${errorMessage}`)
      }
    },
  }
}

function createResendClient(apiKey: string, from: string, replyTo: string | undefined): EmailClient {
  const { Resend } = require('resend');

  const resend = new Resend(apiKey);
  let lastSendTime = 0;

  return {
    async send(to: string, subject: string, html: string): Promise<void> {
      // Enforce minimum 600ms gap between sends (Resend limit is 2 req/s = 500ms; 600ms adds 20% buffer)
      const now = Date.now();
      const elapsed = now - lastSendTime;
      if (elapsed < 600) {
        await new Promise((resolve) => setTimeout(resolve, 600 - elapsed));
      }

      const maxAttempts = 3;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const payload: {
          from: string
          to: string
          subject: string
          html: string
          replyTo?: string
        } = {
          from,
          to,
          subject,
          html,
          ...(replyTo ? { replyTo } : {}),
        }

        const { error } = await resend.emails.send(payload);

        if (!error) {
          lastSendTime = Date.now();
          return;
        }

        // Resend returns "Too Many Requests" on 429; also check statusCode if available
        const resendError = error as { statusCode?: number; message?: string }
        const isRateLimit =
          resendError.statusCode === 429 ||
          resendError.message?.toLowerCase().includes('too many requests') === true
        if (isRateLimit && attempt < maxAttempts - 1) {
          const backoff = 1000 * Math.pow(2, attempt); // 1s, 2s
          console.log(`Rate limited by Resend, retrying in ${backoff}ms (attempt ${attempt + 1}/${maxAttempts})...`);
          await new Promise((resolve) => setTimeout(resolve, backoff));
          continue;
        }

        throw new Error(`Resend error: ${resendError.message || 'Unknown error'}`);
      }
    },
  };
}

function createEmailClient(env: Env, provider: EmailProvider): EmailClient {
  const from = env.EMAIL_FROM || DEFAULT_FROM
  const replyTo = env.EMAIL_REPLY_TO

  if (provider === 'cloudflare') {
    if (!env.EMAIL) {
      throw new Error("EMAIL binding is required when EMAIL_PROVIDER is 'cloudflare'")
    }

    return createCloudflareEmailClient(env.EMAIL, from, replyTo)
  }

  if (!env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is required when EMAIL_PROVIDER is 'resend'")
  }

  return createResendClient(env.RESEND_API_KEY, from, replyTo)
}

async function resolveUserId(
  client: ReturnType<typeof createTwitterClient>,
  username: string,
  kv: KVNamespace
): Promise<string | null> {
  // Check KV cache first
  const cacheKey = `userId:${username.toLowerCase()}`
  const cached = await kv.get(cacheKey)
  if (cached) return cached

  const lookup = await client.getUserIdByUsername(username)
  if (!lookup.success || !lookup.userId) {
    console.log(`[resolveUserId] Failed to resolve @${username}: ${lookup.error}`)
    return null
  }

  // Cache for 7 days — userIds are stable
  await kv.put(cacheKey, lookup.userId, { expirationTtl: 7 * 24 * 60 * 60 })
  return lookup.userId
}

async function fetchUserTweets(
  client: ReturnType<typeof createTwitterClient>,
  username: string,
  limit: number,
  kv: KVNamespace,
  sinceId?: string
): Promise<NormalizedTweet[]> {
  const userId = await resolveUserId(client, username, kv)
  if (!userId) return []

  const startTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  return client.getUserTweets(userId, {
    maxResults: limit,
    sinceId: sinceId || undefined,
    startTime,
  })
}

async function runDigest(env: Env) {
  const config = loadConfig(env.CONFIG_YAML);
  const client = createTwitterClient(env.X_BEARER_TOKEN);
  const prompt = (config.prompt as string | undefined) ?? undefined;
  const llm = createLlmClient(config.llm.model, env.GEMINI_API_KEY, prompt);
  const emailProvider = getEmailProvider(env)
  const email = createEmailClient(env, emailProvider)

  console.log(`Using email provider: ${emailProvider}`)

  const today = new Date().toISOString().split('T')[0];

  for (const user of config.users) {
    const emails = Array.isArray(user.email) ? user.email : [user.email]
    const primaryEmail = emails[0]

    const sentKey = `sent:${today}:${primaryEmail}`;
    const alreadySent = await env.BIRD_WHISPERER.get(sentKey);
    if (alreadySent) {
      console.log(`Already sent digest to ${emails.join(', ')} today`);
      continue;
    }

    console.log(`Processing digest for ${emails.join(', ')}...`);
    const handleSummaries: { username: string; summary: string; links: string[]; tweetCount: number; tweets: NormalizedTweet[] }[] = [];

    for (const follow of user.follows) {
      const lastSeenKey = `lastSeen:${primaryEmail}:${follow.username}`;
      const lastSeenId = await env.BIRD_WHISPERER.get(lastSeenKey);

      console.log(`Fetching tweets for @${follow.username}...`);
      const tweets = await fetchUserTweets(client, follow.username, 20, env.BIRD_WHISPERER, lastSeenId || undefined);

      if (tweets.length === 0) {
        console.log(`No new tweets for @${follow.username}`);
        continue;
      }

      // Store the newest tweet ID for next run
      const newestId = tweets.reduce((max: string, t: NormalizedTweet) =>
        BigInt(t.id) > BigInt(max) ? t.id : max, tweets[0].id);
      await env.BIRD_WHISPERER.put(lastSeenKey, newestId);

      console.log(`Summarizing @${follow.username} (${tweets.length} new tweets)...`)
      const { summary, links, tweetCount } = await llm.summarize(tweets, user.context, follow.username)

      // Convert markdown summary to HTML, then replace [N] references with linked footnotes
      let summaryHtml = await marked.parse(summary)
      summaryHtml = summaryHtml.replace(/\[(\d+)\]/g, (match, num) => {
        const idx = parseInt(num, 10) - 1
        if (idx >= 0 && idx < links.length) {
          return `<a href="${links[idx]}" style="color: ${TWITTER_BLUE}; text-decoration: none; font-weight: 600;">[${num}]</a>`
        }
        return match
      })

      handleSummaries.push({ username: follow.username, summary: summaryHtml, links, tweetCount, tweets })
    }

    if (handleSummaries.length === 0) {
      console.log(`No new tweets for any handles, skipping ${emails.join(', ')}`);
      continue;
    }

    // Aggregate topic detection: identify shared topics across 2+ handles
    let aggregateHtml = ''
    const handlesWithTweets = handleSummaries.filter(h => h.tweets.length > 0)
    if (handlesWithTweets.length >= 2) {
      console.log(`Detecting shared topics across ${handlesWithTweets.length} handles...`)
      try {
        const aggregateMarkdown = await llm.aggregateTopics(
          handlesWithTweets.map(h => ({ username: h.username, tweets: h.tweets })),
          user.context
        )
        if (aggregateMarkdown) {
          // Convert @username mentions to linked handles
          let parsed = await marked.parse(aggregateMarkdown)
          const followedHandles = new Set(handlesWithTweets.map(h => h.username.toLowerCase()))
          parsed = linkFollowedMentionsInHtml(parsed, followedHandles)
          aggregateHtml = parsed
          console.log('Shared topics detected, adding trending section')
        } else {
          console.log('No shared topics detected across handles')
        }
      } catch (err) {
        console.error('Failed to detect aggregate topics:', err)
      }
    }

    const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const trendingSection = aggregateHtml ? `
        <div style="margin-bottom: 30px; padding: 16px 20px; background-color: #f8f9fa; border-radius: 8px; border-left: 4px solid ${TWITTER_BLUE};">
          <h2 style="margin: 0 0 10px 0; font-size: 16px; color: #333;">📡 Trending Across Your Follows</h2>
          <div style="line-height: 1.6;">${aggregateHtml}</div>
        </div>
    ` : ''

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="margin-bottom: 5px;">🐦 Bird Whisperer Digest</h1>
        <p style="color: #666; margin-bottom: 30px;">${dateStr}</p>

        ${trendingSection}

        ${handleSummaries.map((h) => `
          <div style="margin-bottom: 30px; padding-bottom: 20px; border-bottom: 1px solid #eee;">
            <h2 style="margin: 0 0 10px 0;">
              <a href="https://x.com/${h.username}" style="color: ${TWITTER_BLUE}; text-decoration: none;">@${h.username}</a>
            </h2>
            <div style="line-height: 1.6;">${h.summary}</div>
            <p style="color: #666; font-size: 14px;">${h.tweetCount} new tweet${h.tweetCount !== 1 ? 's' : ''}</p>
          </div>
        `).join('')}

        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
        <p style="color: #999; font-size: 12px;">
          Powered by Bird Whisperer
        </p>
      </div>
    `;

    const subject = `🐦 Bird Whisperer Digest — ${dateStr}`;
    for (const recipient of emails) {
      console.log(`Sending digest to ${recipient} (${handleSummaries.length} handles)...`);
      await email.send(recipient, subject, html);
      console.log(`Digest sent to ${recipient}`);
    }
    await env.BIRD_WHISPERER.put(sentKey, new Date().toISOString());
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/trigger' && env.ENABLE_MANUAL_TRIGGER === 'true') {
      try {
        await runDigest(env);
        return new Response('Digest triggered', { status: 200 });
      } catch (error) {
        return new Response(`Error: ${error}`, { status: 500 });
      }
    }

    return new Response('Bird Whisperer Worker');
  },

  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    await runDigest(env);
  },
} satisfies ExportedHandler<Env>;
