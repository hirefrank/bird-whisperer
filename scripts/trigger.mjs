#!/usr/bin/env node

const workerUrl = process.env.WORKER_URL

if (!workerUrl) {
  console.error('WORKER_URL is required. Example: WORKER_URL=https://your-worker.workers.dev pnpm run trigger')
  process.exit(1)
}

const triggerUrl = `${workerUrl.replace(/\/$/, '')}/trigger`

const response = await fetch(triggerUrl)
const body = await response.text()

if (!response.ok) {
  console.error(`Trigger failed (${response.status}): ${body}`)
  process.exit(1)
}

console.log(body)
