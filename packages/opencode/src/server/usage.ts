import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { z } from "zod"
import { Auth } from "@/auth"
import { Config } from "../config/config"

const ClaudeUsageLimit = z
  .object({
    utilization: z.number(),
    resets_at: z.string().nullable(),
  })
  .nullable()

const ClaudeUsageResponse = z.object({
  status: z.enum(["success", "not_authenticated", "error"]),
  message: z.string().optional(),
  five_hour: ClaudeUsageLimit.optional(),
  seven_day: ClaudeUsageLimit.optional(),
})

const QuotaGroup = z.object({
  name: z.string(),
  display: z.string(),
  used: z.number(),
  max: z.number(),
  remaining: z.number(),
  reset_time_iso: z.string().optional().nullable(),
})

const ProxyUsageResponse = z.object({
  status: z.enum(["success", "not_configured", "error"]),
  message: z.string().optional(),
  groups: z.array(QuotaGroup).optional(),
})

const ANTIGRAVITY_GROUP_NAMES: Record<string, string> = {
  claude: "vertex",
  "g3-flash": "flash",
  "g3-pro": "pro",
}

const ANTIGRAVITY_GROUPS = ["claude", "g3-flash", "g3-pro"]

const GEMINI_CLI_GROUP_NAMES: Record<string, string> = {
  pro: "pro",
  "3-flash": "flash",
}

const GEMINI_CLI_GROUPS = ["pro", "3-flash"]

const ANTHROPIC_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"

async function refreshToken(refresh: string) {
  const response = await fetch("https://console.anthropic.com/v1/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refresh,
      client_id: ANTHROPIC_CLIENT_ID,
    }),
  })

  if (!response.ok) {
    return { success: false as const }
  }

  const json = await response.json()

  return { success: true as const, access: json.access_token as string }
}

export const UsageRoute = new Hono()
  .get(
    "/claude",
    describeRoute({
      summary: "Get Claude usage",
      description: "Get Claude Pro/Max usage limits",
      operationId: "provider.usage.claude",
      responses: {
        200: {
          description: "Claude usage data",
          content: {
            "application/json": {
              schema: resolver(ClaudeUsageResponse),
            },
          },
        },
      },
    }),
    async (c) => {
      const auth = await Auth.get("anthropic")

      if (!auth || auth.type !== "oauth") {
        return c.json({ status: "not_authenticated" })
      }

      let accessToken = auth.access

      if (auth.expires < Date.now()) {
        const result = await refreshToken(auth.refresh)
        if (!result.success) {
          return c.json({ status: "error", message: "Token refresh failed" })
        }
        accessToken = result.access
      }

      const response = await fetch("https://api.anthropic.com/api/oauth/usage", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "anthropic-beta": "oauth-2025-04-20",
        },
      })

      if (!response.ok) {
        return c.json({ status: "error", message: `API error: ${response.status}` })
      }

      const data = await response.json()
      return c.json({
        status: "success",
        five_hour: data.five_hour ?? null,
        seven_day: data.seven_day ?? null,
      })
    },
  )
  .get(
    "/antigravity",
    describeRoute({
      summary: "Get Antigravity usage",
      description: "Get Antigravity usage quotas",
      operationId: "provider.usage.antigravity",
      responses: {
        200: {
          description: "Antigravity usage data",
          content: {
            "application/json": {
              schema: resolver(ProxyUsageResponse),
            },
          },
        },
      },
    }),
    async (c) => {
      const config = await Config.get()
      const provider = config.provider?.["antigravity"]

      if (!provider?.options?.baseURL || !provider?.options?.apiKey) {
        return c.json({ status: "not_configured" })
      }

      const baseURL = provider.options.baseURL as string
      const apiKey = provider.options.apiKey as string

      try {
        const response = await fetch(`${baseURL}/quota-stats?provider=antigravity`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "force_refresh",
            scope: "provider",
            provider: "antigravity",
          }),
        })

        if (!response.ok) {
          const text = await response.text()
          return c.json({ status: "error", message: text || `HTTP ${response.status}` })
        }

        const data = await response.json()
        const credential = data.providers?.antigravity?.credentials?.[0]
        const modelGroups = credential?.model_groups ?? {}

        const groups = []

        for (const groupName of ANTIGRAVITY_GROUPS) {
          const group = modelGroups[groupName]
          if (!group) continue

          groups.push({
            name: groupName,
            display: ANTIGRAVITY_GROUP_NAMES[groupName] || groupName,
            used: group.requests_used,
            max: group.requests_max,
            remaining: group.remaining_pct,
            reset_time_iso: group.reset_time_iso || null,
          })
        }

        return c.json({ status: "success", groups })
      } catch (err) {
        return c.json({
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        })
      }
    },
  )
  .get(
    "/gemini-cli",
    describeRoute({
      summary: "Get Gemini CLI usage",
      description: "Get Gemini CLI usage quotas",
      operationId: "provider.usage.gemini-cli",
      responses: {
        200: {
          description: "Gemini CLI usage data",
          content: {
            "application/json": {
              schema: resolver(ProxyUsageResponse),
            },
          },
        },
      },
    }),
    async (c) => {
      const config = await Config.get()
      const provider = config.provider?.["gemini-cli"]

      if (!provider?.options?.baseURL || !provider?.options?.apiKey) {
        return c.json({ status: "not_configured" })
      }

      const baseURL = provider.options.baseURL as string
      const apiKey = provider.options.apiKey as string

      try {
        const response = await fetch(`${baseURL}/quota-stats?provider=gemini_cli`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "force_refresh",
            scope: "provider",
            provider: "gemini_cli",
          }),
        })

        if (!response.ok) {
          const text = await response.text()
          return c.json({ status: "error", message: text || `HTTP ${response.status}` })
        }

        const data = await response.json()
        const credential = data.providers?.gemini_cli?.credentials?.[0]
        const modelGroups = credential?.model_groups ?? {}

        const groups = []

        for (const groupName of GEMINI_CLI_GROUPS) {
          const group = modelGroups[groupName]
          if (!group) continue

          groups.push({
            name: groupName,
            display: GEMINI_CLI_GROUP_NAMES[groupName] || groupName,
            used: group.requests_used,
            max: group.requests_max,
            remaining: group.remaining_pct,
            reset_time_iso: group.reset_time_iso || null,
          })
        }

        return c.json({ status: "success", groups })
      } catch (err) {
        return c.json({
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        })
      }
    },
  )
