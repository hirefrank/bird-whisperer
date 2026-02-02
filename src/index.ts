export interface Env {
  BIRD_WHISPERER: KVNamespace;
  ASSETS: Fetcher;
  AUTH_TOKEN: string;
  CT0: string;
  GEMINI_API_KEY: string;
  RESEND_API_KEY: string;
  ENABLE_MANUAL_TRIGGER?: string;
}

import { loadConfig, type Config } from './config';

function createTwitterClient(authToken: string, ct0: string) {
  const { TwitterClient } = require('@steipete/bird');
  return new TwitterClient({ cookies: { authToken, ct0 } });
}

function createLlmClient(model: string, apiKey: string, customPrompt: string | undefined) {
  const { createGoogleGenerativeAI } = require('@ai-sdk/google');
  const { generateText } = require('ai');

  const google = createGoogleGenerativeAI({ apiKey });
  const prompt = customPrompt || `You are helping someone stay informed about a Twitter user's activity.

Context about the person: {CONTEXT}

Here are their recent tweets:
{TWEETS}

Please summarize in 2-3 sentences:
1. What is this person talking about?
2. Any interesting insights or takeaways?

Keep it concise.`;

  return {
    async summarize(tweets: any[], context: string, twitterUsername: string): Promise<{ summary: string; links: string[]; tweetCount: number }> {
      const tweetText = tweets
        .map((t, i) => `[${i + 1}] ${t.text}`)
        .join('\n\n');

      const links = tweets.map((t) => `https://x.com/${twitterUsername}/status/${t.id}`);

      const { text } = await generateText({
        model: google(model),
        prompt: prompt.replace('{CONTEXT}', context).replace('{TWEETS}', tweetText),
        system: 'You are a helpful assistant that summarizes tweets concisely.',
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
  const lookup = await client.getUserIdByUsername(username);
  if (!lookup.success || !lookup.userId) {
    console.log(`[fetchUserTweets] Failed to resolve @${username}: ${lookup.error}`);
    return [];
  }
  const result = await client.getUserTweets(lookup.userId, limit);
  return result?.tweets || [];
}

async function runDigest(env: Env) {
  const config = loadConfig();
  const client = createTwitterClient(env.AUTH_TOKEN, env.CT0);
  const prompt = (config.prompt as string | undefined) ?? undefined;
  const llm = createLlmClient(config.llm.model, env.GEMINI_API_KEY, prompt);
  const email = createResendClient(env.RESEND_API_KEY);

  const today = new Date().toISOString().split('T')[0];

  for (const user of config.users) {
    const sentKey = `sent:${today}:${user.email}`;
    const alreadySent = await env.BIRD_WHISPERER.get(sentKey);
    if (alreadySent) {
      console.log(`Already sent digest to ${user.email} today`);
      continue;
    }

    console.log(`Processing digest for ${user.email}...`);
    const handleSummaries: { username: string; summary: string; links: string[]; tweetCount: number }[] = [];

    for (const follow of user.follows) {
      const lastSeenKey = `lastSeen:${user.email}:${follow.username}`;
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

      console.log(`Summarizing @${follow.username} (${tweets.length} new tweets)...`);
      const { summary, links, tweetCount } = await llm.summarize(tweets, user.context, follow.username);
      handleSummaries.push({ username: follow.username, summary, links, tweetCount });
    }

    if (handleSummaries.length === 0) {
      console.log(`No new tweets for any handles, skipping ${user.email}`);
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
            <p style="line-height: 1.6;">${h.summary}</p>
            <p style="color: #666; font-size: 14px;">${h.tweetCount} new tweet${h.tweetCount !== 1 ? 's' : ''}</p>
            <ul style="margin: 10px 0; padding-left: 20px; color: #666; font-size: 14px;">
              ${h.links.slice(0, 3).map((link) => `<li><a href="${link}" style="color: #1da1f2;">View tweet</a></li>`).join('')}
            </ul>
          </div>
        `).join('')}

        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
        <p style="color: #999; font-size: 12px;">
          Powered by Bird Whisperer
        </p>
      </div>
    `;

    const subject = `🐦 Bird Whisperer Digest — ${dateStr}`;
    console.log(`Sending digest to ${user.email} (${handleSummaries.length} handles)...`);
    await email.send(user.email, subject, html);
    await env.BIRD_WHISPERER.put(sentKey, new Date().toISOString());
    console.log(`Digest sent to ${user.email}`);
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
