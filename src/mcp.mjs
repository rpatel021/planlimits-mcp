// Minimal MCP server over stdio (JSON-RPC 2.0, newline-delimited). Zero dependencies. Local only.
import readline from 'readline';
import { gather, doRoute } from './core.mjs';
const TOOLS = [
  { name: 'get_my_usage', description: 'Detected local usage for Claude Code and Codex CLI (from local logs on this machine) plus manual states from ~/.planlimits.json: state per plan, basis, reset times. Nothing is uploaded.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'route_me', description: 'Which of my plans to use right now, a fallback, reset times and a weekly rotation, auto-filled from local usage. Only plan ids and states are sent to planlimits.app unless offline=true.', inputSchema: { type: 'object', properties: { task: { type: 'string', enum: ['refactor', 'everyday', 'quick'] }, offline: { type: 'boolean' } }, additionalProperties: false }, annotations: { readOnlyHint: true } }];
export function serve({ offline } = {}) {
  const rl = readline.createInterface({ input: process.stdin });
  const send = m => process.stdout.write(JSON.stringify(m) + '\n');
  rl.on('line', async l => { let m; try { m = JSON.parse(l); } catch { return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
    const { id, method, params } = m; if (id === undefined) return; // notification
    try {
      if (method === 'initialize') return send({ jsonrpc: '2.0', id, result: { protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'planlimits-local', version: '0.1.0' } } });
      if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
      if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
      if (method === 'tools/call') { const g = gather(); let data;
        if (params?.name === 'get_my_usage') data = { plans: g.plans.map(p => ({ plan: p.plan, state: p.state, source: p.source, basis: p.detail?.basis, resets: p.detail?.resets || [] })), detected: g.det, notes: g.notes, config_file: g.cfg.file };
        else if (params?.name === 'route_me') { const a = params.arguments || {}; data = g.plans.length ? await doRoute(g.plans, a.task, { offline: offline || a.offline }) : { ok: false, error: 'No plans detected or configured. Create ~/.planlimits.json (run: planlimits init).' }; }
        else return send({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Unknown tool' } });
        return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(data, null, 1) }], isError: data.ok === false } }); }
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
    } catch (e) { send({ jsonrpc: '2.0', id, error: { code: -32603, message: e.message } }); } });
}
