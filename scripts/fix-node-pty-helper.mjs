import fs from 'node:fs'
import path from 'node:path'

if (process.platform === 'win32') {
  process.exit(0)
}

const prebuildsDir = path.join(process.cwd(), 'node_modules', 'node-pty', 'prebuilds')
if (!fs.existsSync(prebuildsDir)) {
  process.exit(0)
}

const helperPaths = fs
  .readdirSync(prebuildsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(prebuildsDir, entry.name, 'spawn-helper'))

for (const helperPath of helperPaths) {
  if (!fs.existsSync(helperPath)) {
    continue
  }

  try {
    fs.chmodSync(helperPath, 0o755)
  } catch {
    // ignore permission errors; runtime fallback still reports spawn errors clearly
  }
}
