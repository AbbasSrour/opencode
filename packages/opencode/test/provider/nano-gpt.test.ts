import { test, expect, mock } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { Env } from "../../src/env"

test("nano-gpt syncs missing models from /models", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
    const url = input.toString()
    if (url === "https://nano-gpt.com/api/v1/models") {
      expect((init?.headers as Record<string, string>)?.Authorization).toBe("Bearer test-key")
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: [{ id: "moonshotai/kimi-k2.5:thinking" }, { id: "moonshotai/kimi-k2.5-original:thinking" }],
          }),
          { status: 200 },
        ),
      )
    }
    return originalFetch(input, init)
  }) as unknown as typeof fetch

  try {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        Env.set("NANO_GPT_API_KEY", "test-key")
      },
      fn: async () => {
        const providers = await Provider.list()
        expect(providers["nano-gpt"]).toBeDefined()
        expect(providers["nano-gpt"].models["moonshotai/kimi-k2.5:thinking"]).toBeDefined()
        expect(providers["nano-gpt"].models["moonshotai/kimi-k2.5-original:thinking"]).toBeDefined()
        expect(providers["nano-gpt"].models["moonshotai/kimi-k2.5:thinking"].capabilities.reasoning).toBe(true)
      },
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("nano-gpt model sync failure keeps static models", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
    const url = input.toString()
    if (url === "https://nano-gpt.com/api/v1/models") {
      return Promise.resolve(new Response("unauthorized", { status: 401 }))
    }
    return originalFetch(input, init)
  }) as unknown as typeof fetch

  try {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            $schema: "https://opencode.ai/config.json",
          }),
        )
      },
    })

    await Instance.provide({
      directory: tmp.path,
      init: async () => {
        Env.set("NANO_GPT_API_KEY", "test-key")
      },
      fn: async () => {
        const providers = await Provider.list()
        expect(providers["nano-gpt"]).toBeDefined()
        expect(providers["nano-gpt"].models["moonshotai/kimi-k2-thinking"]).toBeDefined()
      },
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})
