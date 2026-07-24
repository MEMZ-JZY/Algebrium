// @ts-expect-error Bun provides this module when running the focused regression test.
import { expect, test } from "bun:test"
import { citationURL } from "./web-sources"

test("renders HTTP and HTTPS citations as safe links", () => {
  expect(citationURL("https://dlmf.nist.gov/1.1")).toBe("https://dlmf.nist.gov/1.1")
  expect(citationURL("http://dlmf.nist.gov/1.1")).toBe("http://dlmf.nist.gov/1.1")
  expect(citationURL("javascript:alert(1)")).toBeUndefined()
})
