import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { z } from 'zod';

const FollowSchema = z.object({
  username: z.string(),
});

const UserSchema = z.object({
  email: z.string().email(),
  context: z.string(),
  follows: FollowSchema.array(),
});

const ConfigSchema = z.object({
  users: UserSchema.array(),
  llm: z.object({
    provider: z.enum(['google', 'openai', 'anthropic']),
    model: z.string(),
  }),
  prompt: z.string().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;
export type User = Config['users'][number];
export type Follow = User['follows'][number];

export function loadConfig(configPath?: string): Config {
  const filePath = configPath || path.resolve('config.yaml');
  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = yaml.load(raw) as Record<string, unknown>;
  if (parsed.prompt === null) {
    parsed.prompt = undefined;
  }
  return ConfigSchema.parse(parsed);
}
