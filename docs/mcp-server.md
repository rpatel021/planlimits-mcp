# PlanLimits MCP servers

Full docs: https://planlimits.app/mcp-docs/

## Remote server (plan data)

Read-only, no auth. Streamable HTTP endpoint: `https://planlimits.app/mcp`

Tools:

- `list_plans`
- `get_tool_plans(tool_id)`
- `get_recent_changes(since?)`
- `recommend_plan(budget_usd, use?)`
- `route_task(plans: [{plan, state}], task?)`: which of your plans to use now, a fallback, reset windows, rationale and a weekly rotation.
- `can_afford_task(plans: [{plan, state}], size?, current?, task?)`: whether to start a task now. Returns go, wait or switch, which plan to use, reasons and reset windows. Task size (small, medium or large) is a rough estimate, since vendors don't publish per-task usage.
- `pick_plan(interface?, budget_usd?, usage?, who?)`: the cheapest plan that fits your answers, with reasons, up to 3 alternatives and source links.
- `get_service_status(provider?)`: live status and open incidents from official vendor status pages. Shows outages only, not throttling or per-account limits. Omit provider for all.

Every response includes source links and checked dates.

### Cursor

Add to `~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project):

```json
{ "mcpServers": { "planlimits": { "url": "https://planlimits.app/mcp" } } }
```

### Claude Code

```sh
claude mcp add --transport http planlimits https://planlimits.app/mcp
```

### Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.planlimits]
url = "https://planlimits.app/mcp"
```

### Test with curl

```sh
curl -s https://planlimits.app/mcp -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Local server (your own usage)

`planlimits mcp` runs a stdio MCP server (`src/mcp.mjs`) with two tools:

- `get_my_usage`: state, basis and reset times per plan, from local Claude Code and Codex CLI logs plus `~/.planlimits.json`. Nothing is uploaded.
- `route_me(task?, offline?)`: which plan to use now, a fallback and a weekly rotation. Sends only plan ids and states to planlimits.app unless offline.

Claude Code:

```sh
claude mcp add planlimits-local -- npx -y https://planlimits.app/cli/planlimits.tgz mcp
```

Cursor (`~/.cursor/mcp.json`):

```json
{ "mcpServers": { "planlimits-local": { "command": "npx", "args": ["-y", "https://planlimits.app/cli/planlimits.tgz", "mcp"] } } }
```

Add `--offline` to the args to keep everything on your machine.
