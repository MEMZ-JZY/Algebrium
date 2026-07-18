import { describe, expect, test } from "bun:test"
import { SubjectRegistry, createSubjectRegistry, mathModule } from "@/sigmaforge/subject"
import { allowedToolIDs, assertToolAllowed } from "@/sigmaforge/policy"
import { SigmaForgeSessions } from "@/sigmaforge/session"

describe("SigmaForge subjects", () => {
  test("registers math by default and resolves the physics stub", () => {
    const registry = createSubjectRegistry()
    expect(registry.resolve().id).toBe("math")
    expect(registry.resolve("physics").id).toBe("physics")
  })

  test("rejects duplicate and unknown subjects", () => {
    const registry = new SubjectRegistry()
    registry.register(mathModule)
    expect(() => registry.register(mathModule)).toThrow("Subject already registered")
    expect(() => registry.resolve("chemistry")).toThrow("Unknown subject: chemistry")
  })

  test("stores subject and injects its system prompt", () => {
    const sessions = new SigmaForgeSessions()
    const session = sessions.create({ subject: "math" })
    expect(sessions.get(session.id)).toEqual(session)
    expect(session.systemPrompt).toContain("数学助教")
  })
})

describe("SigmaForge tool policy", () => {
  test("only exposes explicit subject tools and blocks developer tools", () => {
    const subject = { ...mathModule, tools: [{ id: "cas", description: "CAS" }, { id: "bash", description: "shell" }] }
    expect(allowedToolIDs(subject)).toEqual(["cas"])
    expect(() => assertToolAllowed(subject, "bash")).toThrow("Tool is disabled")
  })
})
