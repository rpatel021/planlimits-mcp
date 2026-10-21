# planlimits

Free tools for checking AI coding plan limits: a local CLI and MCP servers for [PlanLimits](https://planlimits.app).

MCP docs: https://planlimits.app/mcp-docs/

## Free tools

- **CLI** (`planlimits`): reads your local Claude Code and Codex CLI logs, shows usage, state and reset times per plan, and tells you which plan to use next.
- **Local MCP server** (`planlimits mcp`): exposes `get_my_usage` and `route_me` to your agent over stdio.
- **Remote MCP server** (`https://planlimits.app/mcp`): read-only plan data, no auth: `list_plans`, `get_tool_plans`, `get_recent_changes`, `recommend_plan`, `route_task`, `can_afford_task`, `pick_plan`, `get_service_status`.

## Install and run the CLI

Requires Node 18+. Zero dependencies.

```sh
npx https://planlimits.app/cli/planlimits.tgz status
```

Or from this repo:

```sh
git clone https://github.com/rpatel021/planlimits-mcp
cd planlimits-mcp
node bin/planlimits.mjs status     # or: npm link, then planlimits status
```

Commands:

```
planlimits status [--json]                       usage, state and resets per plan
planlimits route [--task refactor|everyday|quick] [--offline] [--json]
planlimits mcp [--offline]                       local stdio MCP server
planlimits watch [--threshold 80] [--interval 60] [--once] [--no-desktop] [--json]
planlimits init                                  write a ~/.planlimits.json template
planlimits hook install|uninstall claude-code [--yes]
planlimits handoff codex [--print]
```

Logs read: `~/.claude/projects`, `~/.config/claude/projects` or `$CLAUDE_CONFIG_DIR`; `$CODEX_HOME/sessions` or `~/.codex/sessions`.

Privacy: online `route` sends only plan ids, states and task to `planlimits.app/api/v1/route`. `--offline` (or `PLANLIMITS_OFFLINE=1`) sends nothing. `watch` never uses the network. Codex percentages are server-reported; Claude Code percentages are estimates against your own thresholds in `~/.planlimits.json`, since Anthropic publishes no token limits.

Tests: `bash test/run-tests.sh` (uses temporary HOME directories).

## Connect the MCP server

Remote (plan data):

```sh
claude mcp add --transport http planlimits https://planlimits.app/mcp
```

Cursor `~/.cursor/mcp.json`:

```json
{ "mcpServers": { "planlimits": { "url": "https://planlimits.app/mcp" } } }
```

Local (your own usage):

```sh
claude mcp add planlimits-local -- npx -y https://planlimits.app/cli/planlimits.tgz mcp
```

Codex, curl testing and more: [docs/mcp-server.md](docs/mcp-server.md) and https://planlimits.app/mcp-docs/.

## License

MIT. See [LICENSE](LICENSE).
