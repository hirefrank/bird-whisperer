import { execSync } from 'child_process';
import path from 'path';

export interface Tweet {
  id: string;
  text: string;
  createdAt: string;
  replyCount: number;
  retweetCount: number;
  likeCount: number;
}

function getBirdPath(): string {
  return path.resolve(process.cwd(), 'node_modules/.bin/bird');
}

export function fetchUserTweets(
  username: string,
  limit = 20,
  cookieSource?: 'chrome' | 'safari' | 'firefox',
  chromeProfileDir?: string
): Tweet[] {
  try {
    const cookieFlag = cookieSource ? `--cookie-source ${cookieSource}` : '';
    const chromeFlag = chromeProfileDir ? `--chrome-profile-dir ${chromeProfileDir}` : '';
    const output = execSync(
      `${getBirdPath()} user-tweets @${username} -n ${limit} --json ${cookieFlag} ${chromeFlag}`,
      { encoding: 'utf-8' }
    );
    const tweets = JSON.parse(output);
    return tweets.map((t: Record<string, unknown>) => ({
      id: t.id as string,
      text: t.text as string,
      createdAt: t.createdAt as string,
      replyCount: t.replyCount as number,
      retweetCount: t.retweetCount as number,
      likeCount: t.likeCount as number,
    }));
  } catch (error) {
    console.error(`Failed to fetch tweets for @${username}:`, error);
    return [];
  }
}
