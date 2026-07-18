import { expect, test } from "bun:test"
import { KernelGatewayClient } from "@/sigmaforge/kernel"
import { mathModule } from "@/sigmaforge/subject"
import { verifyStep } from "@/sigmaforge/verifier"

test.skipIf(process.env.SIGMAFORGE_CAS_INTEGRATION !== "1")("executes Sage and returns a PNG through Kernel Gateway", async () => {
  const client = new KernelGatewayClient(undefined, 60_000)
  try {
    expect((await client.execute("integration", "print(2+2)")).text).toBe("4")
    expect((await client.execute("integration", "sigma_state=41; print(sigma_state+1)")).text).toBe("42")
    expect((await client.execute("isolated", "print('sigma_state' in globals())")).text).toBe("False")
    expect((await client.execute("integration", "var('x'); print(integral(x*e^x,x))")).text).toContain("(x - 1)*e^x")
    expect(await verifyStep(client, "integration", mathModule, { lhs: "diff((x-1)*e^x,x)", rhs: "x*e^x" })).toMatchObject({ verified: true })
    expect((await client.execute("integration", "var('x'); plot(x*e^x,(x,-3,2)).show()")).images.length).toBeGreaterThan(0)
  } finally {
    await client.dispose()
  }
})
