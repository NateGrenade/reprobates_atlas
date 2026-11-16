import type { AddonMainContext } from '../../src/main/addons'

export function activate(ctx: AddonMainContext) {
  ctx.handle('ping', (text: string) => `pong: ${text} (vault ${ctx.vaultRoot() ? 'open' : 'closed'})`)
}
