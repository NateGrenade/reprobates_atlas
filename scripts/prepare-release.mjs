import { rmSync } from 'node:fs'
// Keep release bundles independent of whichever add-ons were last used for testing.
for (const dir of ['out/addons', 'out/addons-test']) rmSync(dir, { recursive: true, force: true })
