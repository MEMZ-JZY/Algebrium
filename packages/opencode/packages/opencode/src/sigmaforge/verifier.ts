import { z } from "zod"
import { quoteSageString } from "./expression"
import type { KernelExecutor } from "./kernel"
import { assertToolAllowed } from "./policy"
import type { SubjectModule } from "./subject"

const schema = z.object({ lhs: z.string().min(1).max(500), rhs: z.string().min(1).max(500), domain: z.string().max(200).optional() })

export type VerificationResult = {
  verified: boolean
  normalized: string
  evidence: string
  domainNote: string
}

export async function verifyStep(
  kernel: KernelExecutor,
  sessionID: string,
  subject: SubjectModule,
  input: unknown,
): Promise<VerificationResult> {
  assertToolAllowed(subject, "verify")
  const request = schema.parse(input)
  const output = await kernel.execute(
    sessionID,
    `d=(sage_eval(${quoteSageString(request.lhs)},locals=globals())-sage_eval(${quoteSageString(request.rhs)},locals=globals())).simplify_full(); print(repr(d)); print(bool(d == 0))`,
  )
  const lines = output.text.split(/\r?\n/).filter(Boolean)
  const verdict = lines.at(-1)?.toLowerCase()
  return {
    verified: verdict === "true" || verdict === "1",
    normalized: lines[0] ?? "",
    evidence: output.text,
    domainNote: request.domain ?? "符号验证未自动证明定义域，请检查原表达式的定义域。",
  }
}

export * as SigmaForgeVerifier from "./verifier"
