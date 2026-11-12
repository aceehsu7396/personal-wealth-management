// Worker entry: Cloudflare treats every named export here as a handler, so
// the logic lives in app.ts and only the default export is defined here.
import { handle, wakeAll, type Env } from './app'

export default {
  fetch: (req: Request, env: Env) => handle(req, env),
  scheduled: async (_event: unknown, env: Env) => {
    await wakeAll(env)
  },
}
