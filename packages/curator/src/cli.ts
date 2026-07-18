import { parseArgs } from "node:util"
import { Curator } from "./curator"

const args = parseArgs({ args: Bun.argv.slice(2), allowPositionals: true })
const command = args.positionals[0]
if (!command) throw new Error("Usage: bun run curator <collect|index-refresh|cleanup|difficulty|health|graph-rebuild|process-mistakes>")

const curator = new Curator()
try {
  const result = command === "collect" ? await curator.collect()
    : command === "index-refresh" ? await curator.refreshIndex()
    : command === "cleanup" ? curator.cleanup()
    : command === "difficulty" ? curator.recalibrateDifficulty()
    : command === "health" ? await curator.health()
    : command === "graph-rebuild" ? curator.rebuildTheoryGraph()
    : command === "process-mistakes" ? curator.processPendingMistakes()
    : undefined
  if (!result) throw new Error(`Unknown Curator command: ${command}`)
  console.log(JSON.stringify(result, null, 2))
} finally {
  curator.kb.close()
}
