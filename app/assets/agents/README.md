# Agent client marks

One monochrome SVG per client vapor knows how to connect, 24×24, `fill="currentColor"`, no title. Rendered inline by `app/components/AgentClientIcon.tsx` (so they follow the theme) and listed in `app/shared/agent-clients.ts`, which also maps an MCP client's `clientInfo.name` to one of these ids so an agent's client can be shown next to it.

Brand marks are from [Simple Icons](https://simpleicons.org) (CC0): Claude (the Claude symbol, not Anthropic's mark), OpenAI for ChatGPT (which covers Codex), Cursor, Google Gemini, and Visual Studio Code (from the release that still carried it). `other.svg` is vapor's own generic mark for any other MCP client or a webhook, and `lmstudio.svg` is vapor's own placeholder for LM Studio (a local-model glyph, not the product's logo) until a CC0 mark exists.
