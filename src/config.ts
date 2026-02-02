import yaml from 'js-yaml';
import { z } from 'zod';
import configYaml from '../config.yaml';

const FollowSchema = z.object({
  username: z.string(),
});

const UserSchema = z.object({
  email: z.union([z.string().email(), z.string().email().array()]),
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

export function loadConfig(): Config {
  const parsed = yaml.load(configYaml) as Record<string, unknown>;
  if (parsed.prompt === null) {
    parsed.prompt = undefined;
  }
  return ConfigSchema.parse(parsed);
}
