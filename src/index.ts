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
  };
}

function createResendClient(apiKey: string) {
  const { Resend } = require('resend');

  const resend = new Resend(apiKey);

  return {
    async send(to: string, subject: string, html: string): Promise<void> {
      const { error } = await resend.emails.send({
        from: 'Bird Whisperer <noreply@notifications.hirefrank.com>',
        to,
        subject,
        html,
      });
      if (error) {
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
    const handleSummaries: { username: string; summary: string; links: string[]; tweetCount: number }[] = [];

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

      handleSummaries.push({ username: follow.username, summary: summaryHtml, links, tweetCount })
    }

    if (handleSummaries.length === 0) {
      console.log(`No new tweets for any handles, skipping ${emails.join(', ')}`);
      continue;
    }

    const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="margin-bottom: 5px;">🐦 Bird Whisperer Digest</h1>
        <p style="color: #666; margin-bottom: 30px;">${dateStr}</p>

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
