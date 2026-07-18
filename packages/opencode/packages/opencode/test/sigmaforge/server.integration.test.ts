import { expect, test } from "bun:test"
import { KernelGatewayClient } from "@/sigmaforge/kernel"
import { startSigmaForgeServer } from "@/sigmaforge/server"

test.skipIf(process.env.SIGMAFORGE_CAS_INTEGRATION !== "1")("streams a CAS-verified integral and real plot artifact", async () => {
  const kernel = new KernelGatewayClient()
  const server = startSigmaForgeServer({ port: 0, kernel })
  try {
    const origin = `http://${server.hostname}:${server.port}`
    const created = await fetch(`${origin}/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
    const session = (await created.json()) as { id: string }
    const events = fetch(`${origin}/sessions/${session.id}/events`)
    await Bun.sleep(10)
    const sent = await fetch(`${origin}/sessions/${session.id}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "求 ∫ x e^x dx" }) })
    expect(sent.status).toBe(202)
    const stream = await (await events).text()
    expect(stream).toContain("(x - 1)*e^x")
    expect(stream).toContain("✓ 通过")
    expect(stream).toContain('"kind":"plotly2d"')
    expect(stream).toContain('"type":"done"')
  } finally {
    server.stop(true)
    await kernel.dispose()
  }
})
