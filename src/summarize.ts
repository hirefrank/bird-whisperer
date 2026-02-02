import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText } from 'ai';
import type { Tweet } from './twitter.js';

export interface LlmClient {
  summarize(tweets: Tweet[], context: string): Promise<string>;
}

export function createLlmClient(model: string, apiKey: string): LlmClient {
  const google = createGoogleGenerativeAI({ apiKey });

  const prompt = `You are helping someone stay informed about a Twitter user's activity.

Context about the person: {CONTEXT}

Here are their recent tweets:
{TWEETS}

Please summarize:
1. What is this person talking about?
2. Why might the person in context care about this?
3. Any interesting insights or takeaways?

Keep it concise but informative.`;

  return {
    async summarize(tweets: Tweet[], context: string): Promise<string> {
      const tweetText = tweets
        .map((t) => `[${t.likeCount}❤️ ${t.retweetCount}🔁] ${t.text}`)
        .join('\n\n');

      const { text } = await generateText({
        model: google(model),
        prompt: prompt.replace('{CONTEXT}', context).replace('{TWEETS}', tweetText),
        system: 'You are a helpful assistant that summarizes tweets in a useful way.',
      });

      return text;
    },
  };
}
