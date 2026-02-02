#!/usr/bin/env node
import { extractCookiesFromChrome } from '@steipete/bird';

const profileDir = process.env.CHROME_PROFILE_DIR || `${process.env.HOME}/.config/chromium/Default`;
const { cookies } = await extractCookiesFromChrome(profileDir);

if (!cookies.authToken || !cookies.ct0) {
  console.error('Failed to extract cookies from Chrome profile:', profileDir);
  process.exit(1);
}

console.log(JSON.stringify({ authToken: cookies.authToken, ct0: cookies.ct0 }));
