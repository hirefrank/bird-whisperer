export interface Env {
  BIRD_WHISPERER: KVNamespace;
  ASSETS: Fetcher;
  AUTH_TOKEN: string;
  CT0: string;
  GEMINI_API_KEY: string;
  RESEND_API_KEY: string;
  ENABLE_MANUAL_TRIGGER?: string;
}

import { loadConfig, type Config } from './config'
import { marked } from 'marked'

function createTwitterClient(authToken: string, ct0: string) {
  const { TwitterClient } = require('@steipete/bird');
  return new TwitterClient({ cookies: { authToken, ct0 } });
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
    async summarize(tweets: any[], context: string, twitterUsername: string): Promise<{ summary: string; links: string[]; tweetCount: number }> {
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
        prompt: prompt.replace('{CONTEXT}', context).replace('{TWEETS}', tweetText),
        system: 'You write concise, natural-sounding newsletter summaries. You never pad content or use filler phrases. You sound like a person, not an AI.',
      });

      return { summary: text, links, tweetCount: tweets.length };
    },

    async aggregateTopics(handleTweets: { username: string; tweets: any[] }[], context: string): Promise<string> {
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
        prompt: aggregatePrompt.replace('{CONTEXT}', context).replace('{GROUPED_TWEETS}', groupedText),
        system: 'You write concise, natural-sounding newsletter summaries. You never pad content or use filler phrases. You sound like a person, not an AI.',
      })

      if (text.trim() === 'NO_SHARED_TOPICS') {
        return ''
      }

      return text
    },
  };
}

function createResendClient(apiKey: string) {
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
        const { error } = await resend.emails.send({
          from: 'Bird Whisperer <noreply@notifications.hirefrank.com>',
          to,
          subject,
          html,
        });

        if (!error) {
          lastSendTime = Date.now();
          return;
        }

        // Resend returns "Too Many Requests" on 429; also check statusCode if available
        const isRateLimit =
          (error as any).statusCode === 429 ||
          error.message?.toLowerCase().includes('too many requests');
        if (isRateLimit && attempt < maxAttempts - 1) {
          const backoff = 1000 * Math.pow(2, attempt); // 1s, 2s
          console.log(`Rate limited by Resend, retrying in ${backoff}ms (attempt ${attempt + 1}/${maxAttempts})...`);
          await new Promise((resolve) => setTimeout(resolve, backoff));
          continue;
        }

        throw new Error(`Resend error: ${error.message}`);
      }
    },
  };
}

async function fetchUserTweets(client: any, username: string, limit: number) {
  const lookup = await client.getUserIdByUsername(username)
  if (!lookup.success || !lookup.userId) {
    console.log(`[fetchUserTweets] Failed to resolve @${username}: ${lookup.error}`)
    return []
  }
  const result = await client.getUserTweets(lookup.userId, limit)
  const tweets = result?.tweets || []

  const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000
  return tweets.filter((t: any) => {
    if (!t.createdAt) return true
    const ts = new Date(t.createdAt).getTime()
    return !isNaN(ts) && ts > twentyFourHoursAgo
  })
}

async function runDigest(env: Env) {
  const config = loadConfig();
  const client = createTwitterClient(env.AUTH_TOKEN, env.CT0);
  const prompt = (config.prompt as string | undefined) ?? undefined;
  const llm = createLlmClient(config.llm.model, env.GEMINI_API_KEY, prompt);
  const email = createResendClient(env.RESEND_API_KEY);

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
    const handleSummaries: { username: string; summary: string; links: string[]; tweetCount: number; tweets: any[] }[] = [];

    for (const follow of user.follows) {
      const lastSeenKey = `lastSeen:${primaryEmail}:${follow.username}`;
      const lastSeenId = await env.BIRD_WHISPERER.get(lastSeenKey);

      console.log(`Fetching tweets for @${follow.username}...`);
      let tweets = await fetchUserTweets(client, follow.username, 20);

      if (lastSeenId) {
        tweets = tweets.filter((t: any) => BigInt(t.id) > BigInt(lastSeenId));
      }

      if (tweets.length === 0) {
        console.log(`No new tweets for @${follow.username}`);
        continue;
      }

      // Store the newest tweet ID for next run
      const newestId = tweets.reduce((max: string, t: any) =>
        BigInt(t.id) > BigInt(max) ? t.id : max, tweets[0].id);
      await env.BIRD_WHISPERER.put(lastSeenKey, newestId);

      console.log(`Summarizing @${follow.username} (${tweets.length} new tweets)...`)
      const { summary, links, tweetCount } = await llm.summarize(tweets, user.context, follow.username)

      // Convert markdown summary to HTML, then replace [N] references with linked footnotes
      let summaryHtml = await marked.parse(summary)
      summaryHtml = summaryHtml.replace(/\[(\d+)\]/g, (match, num) => {
        const idx = parseInt(num, 10) - 1
        if (idx >= 0 && idx < links.length) {
          return `<a href="${links[idx]}" style="color: #1da1f2; text-decoration: none; font-weight: 600;">[${num}]</a>`
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
          parsed = parsed.replace(/@(\w+)/g, (match, username) => {
            const isFollowed = handlesWithTweets.some(h => h.username.toLowerCase() === username.toLowerCase())
            if (isFollowed) {
              return `<a href="https://x.com/${username}" style="color: #1da1f2; text-decoration: none; font-weight: 600;">@${username}</a>`
            }
            return match
          })
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
        <div style="margin-bottom: 30px; padding: 16px 20px; background-color: #f8f9fa; border-radius: 8px; border-left: 4px solid #1da1f2;">
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
              <a href="https://x.com/${h.username}" style="color: #1da1f2; text-decoration: none;">@${h.username}</a>
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
