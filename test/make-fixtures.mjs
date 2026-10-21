// Realistic fixtures matching the documented formats (Claude Code projects JSONL; Codex rollout token_count events).
import fs from 'fs'; import path from 'path';
const [home, scenario = 'mixed'] = process.argv.slice(2); const now = Date.now(), iso = ms => new Date(ms).toISOString();
const cdir = path.join(home, '.claude', 'projects', '-home-dev-myapp'); fs.mkdirSync(cdir, { recursive: true });
const sid = '7f3c2a1e-0000-4000-8000-000000000001'; const L = [];
const asst = (ms, id, inT, outT, text = 'Done.') => ({ parentUuid: null, isSidechain: false, userType: 'external', cwd: '/home/dev/myapp', sessionId: sid, version: '2.1.40', type: 'assistant', requestId: 'req_' + id, uuid: 'u' + id, timestamp: iso(ms),
  message: { id: 'msg_' + id, type: 'message', role: 'assistant', model: 'claude-sonnet-5', content: [{ type: 'text', text }], usage: { input_tokens: inT, cache_creation_input_tokens: 2000, cache_read_input_tokens: 30000, output_tokens: outT } } });
L.push({ type: 'user', sessionId: sid, timestamp: iso(now - 3 * 864e5), message: { role: 'user', content: 'refactor auth module' } });
for (let i = 0; i < 20; i++) L.push(asst(now - 3 * 864e5 + i * 6e4, 'old' + i, 1200, 800));
for (let i = 0; i < 30; i++) L.push(asst(now - 100 * 6e4 + i * 2e5, 'cur' + i, 1500, 900));
L.push(asst(now - 100 * 6e4 + 5 * 2e5, 'cur5', 1500, 900)); // duplicate (same message id + request id) must be ignored
if (scenario === 'claude-limit') L.push({ ...asst(now - 5 * 6e4, 'lim', 0, 0, `Claude AI usage limit reached|${Math.floor((now + 2 * 36e5) / 1000)}`), isApiErrorMessage: true });
fs.writeFileSync(path.join(cdir, sid + '.jsonl'), L.map(j => JSON.stringify(j)).join('\n') + '\n');
const d = new Date(now), xdir = path.join(home, '.codex', 'sessions', String(d.getUTCFullYear()), String(d.getUTCMonth() + 1).padStart(2, '0'), String(d.getUTCDate()).padStart(2, '0')); fs.mkdirSync(xdir, { recursive: true });
const pct = scenario === 'codex-weekly-hit' ? [40, 100] : [62, 85];
const X = [{ timestamp: iso(now - 50 * 6e4), type: 'session_meta', payload: { id: 'abc', cwd: '/home/dev/myapp', cli_version: '0.60.0' } },
  { timestamp: iso(now - 40 * 6e4), type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 41000, output_tokens: 15000 }, last_token_usage: { input_tokens: 4000, output_tokens: 1500 } }, rate_limits: { limit_id: 'codex', primary: { used_percent: 30, window_minutes: 300, resets_at: Math.floor((now + 3 * 36e5) / 1000) }, secondary: { used_percent: 70, window_minutes: 10080, resets_at: Math.floor((now + 3 * 864e5) / 1000) }, plan_type: 'plus', rate_limit_reached_type: null } } },
  { timestamp: iso(now - 10 * 6e4), type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 61000, output_tokens: 21000 }, last_token_usage: { input_tokens: 5000, output_tokens: 2000 } }, rate_limits: { limit_id: 'codex', primary: { used_percent: pct[0], window_minutes: 300, resets_at: Math.floor((now + 3 * 36e5) / 1000) }, secondary: { used_percent: pct[1], window_minutes: 10080, resets_at: Math.floor((now + 3 * 864e5) / 1000) }, plan_type: 'plus', rate_limit_reached_type: pct[1] >= 100 ? 'secondary' : null } } }];
fs.writeFileSync(path.join(xdir, `rollout-${iso(now).replace(/[:.]/g, '-')}-abc.jsonl`), X.map(j => JSON.stringify(j)).join('\n') + '\n');
console.log('fixtures in', home, scenario);
