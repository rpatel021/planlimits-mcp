// Local usage detection. Reads only local files; never uploads them.
import fs from 'fs'; import path from 'path'; import os from 'os';
const H = () => process.env.HOME || os.homedir();
const DAY = 864e5, FIVE_H = 5 * 36e5;
export function loadConfig() {
  const f = path.join(H(), '.planlimits.json');
  try { return { file: f, exists: true, ...JSON.parse(fs.readFileSync(f, 'utf8')) }; } catch (e) { return { file: f, exists: fs.existsSync(f), parseError: fs.existsSync(f) ? e.message : null }; }
}
function walk(dir, out = [], depth = 0, since = 0) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) { const p = path.join(dir, e.name);
    if (e.isDirectory() && depth < 6) walk(p, out, depth + 1, since);
    else if (e.isFile() && e.name.endsWith('.jsonl')) { try { if (fs.statSync(p).mtimeMs >= since) out.push(p); } catch {} } }
  return out;
}
function* lines(f) { let t; try { t = fs.readFileSync(f, 'utf8'); } catch { return; } for (const l of t.split('\n')) { if (!l.trim()) continue; try { yield JSON.parse(l); } catch {} } }
// ---- Claude Code: ~/.claude/projects/**/*.jsonl and ~/.config/claude/projects (or CLAUDE_CONFIG_DIR, comma separated)
export function claudeDirs() {
  const env = process.env.CLAUDE_CONFIG_DIR;
  const bases = env ? env.split(',').map(s => s.trim()).filter(Boolean) : [path.join(H(), '.config', 'claude'), path.join(H(), '.claude')];
  return bases.map(b => path.join(b, 'projects')).filter(d => fs.existsSync(d));
}
const LIMIT_RE = /(usage limit reached|limit reached|hit your (usage )?limit|you've reached your limit)/i;
export function detectClaude(cfg = {}, now = Date.now()) {
  const dirs = claudeDirs(); if (!dirs.length) return { tool: 'claude-code', found: false, note: 'No Claude Code logs found (~/.claude/projects or ~/.config/claude/projects).' };
  const files = dirs.flatMap(d => walk(d, [], 0, now - 8 * DAY)); const seen = new Set(); const ev = []; const limits = [];
  for (const f of files) for (const j of lines(f)) {
    const ts = Date.parse(j.timestamp); if (!ts || ts < now - 8 * DAY || ts > now + 6e4) continue;
    const m = j.message || {}; const u = m.usage;
    const txt = Array.isArray(m.content) ? m.content.map(c => c?.text || '').join(' ') : (typeof m.content === 'string' ? m.content : '');
    if (j.type === 'assistant' && LIMIT_RE.test(txt)) { const ep = (txt.match(/\|(\d{10})\b/) || [])[1]; limits.push({ ts, weekly: /week/i.test(txt), resetAt: ep ? +ep * 1000 : null, text: txt.slice(0, 120) }); }
    if (!u) continue; const key = (m.id || '') + ':' + (j.requestId || ''); if (key !== ':' && seen.has(key)) continue; seen.add(key);
    ev.push({ ts, tokens: (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0), cacheRead: u.cache_read_input_tokens || 0 });
  }
  ev.sort((a, b) => a.ts - b.ts);
  // ccusage-style 5h blocks: a block starts at the hour floor of the first message after a 5h gap / block end.
  let blockStart = null, blockEnd = null;
  for (const e of ev) { if (blockStart === null || e.ts >= blockEnd) { blockStart = Math.floor(e.ts / 36e5) * 36e5; blockEnd = blockStart + FIVE_H; } }
  const active = blockEnd !== null && now < blockEnd;
  const sessTokens = active ? ev.filter(e => e.ts >= blockStart).reduce((s, e) => s + e.tokens, 0) : 0;
  const weekTokens = ev.filter(e => e.ts >= now - 7 * DAY).reduce((s, e) => s + e.tokens, 0);
  const days = [...Array(7)].map((_, i) => { const d0 = new Date(now - i * DAY); const k = d0.toISOString().slice(0, 10); return { day: k, tokens: ev.filter(e => new Date(e.ts).toISOString().slice(0, 10) === k).reduce((s, e) => s + e.tokens, 0) }; });
  const th = cfg.thresholds?.['claude-code'] || {};
  let state = 'fine', basis = [], resets = [];
  if (active) resets.push({ window: '5h session (estimated block, ccusage-style)', at: new Date(blockEnd).toISOString() });
  const lastLimit = limits.filter(l => active ? l.ts >= blockStart : l.ts >= now - FIVE_H).pop();
  const weeklyLimit = limits.filter(l => l.weekly && l.ts >= now - 7 * DAY && (!l.resetAt || l.resetAt > now)).pop();
  if (weeklyLimit) { state = 'weekly_hit'; basis.push('a weekly limit message appears in your logs'); if (weeklyLimit.resetAt) resets.push({ window: 'weekly (from limit message)', at: new Date(weeklyLimit.resetAt).toISOString() }); }
  else if (lastLimit && (!lastLimit.resetAt || lastLimit.resetAt > now)) { state = 'session_hit'; basis.push('a usage-limit message appears in your current 5h window'); if (lastLimit.resetAt) resets.push({ window: '5h (from limit message)', at: new Date(lastLimit.resetAt).toISOString() }); }
  else if (th.session_tokens && sessTokens >= th.session_tokens) { state = 'session_hit'; basis.push(`5h tokens ${sessTokens} >= your threshold ${th.session_tokens} (estimate)`); }
  else if (th.weekly_tokens && weekTokens >= th.weekly_tokens) { state = 'exhausted'; basis.push(`7-day tokens ${weekTokens} >= your threshold ${th.weekly_tokens} (estimate)`); }
  else if ((th.session_tokens && sessTokens >= (th.low_ratio || 0.8) * th.session_tokens) || (th.weekly_tokens && weekTokens >= (th.low_ratio || 0.8) * th.weekly_tokens)) { state = 'low'; basis.push(`at or above ${Math.round((th.low_ratio || 0.8) * 100)}% of your own threshold (estimate)`); }
  else basis.push(th.session_tokens || th.weekly_tokens ? 'below your thresholds (estimate)' : 'no limit message found; Anthropic publishes no token limits, so set thresholds in ~/.planlimits.json for low/hit detection (estimate)');
  return { tool: 'claude-code', found: true, files: files.length, state, estimate: !weeklyLimit && !lastLimit, basis: basis.join('; '), session_tokens: sessTokens, block_start: active ? new Date(blockStart).toISOString() : null, weekly_tokens_7d: weekTokens, days, resets, limit_messages: limits.length };
}
// ---- Codex CLI: $CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl; token_count events carry server-reported rate_limits.
export function codexDir() { return path.join(process.env.CODEX_HOME || path.join(H(), '.codex'), 'sessions'); }
export function detectCodex(cfg = {}, now = Date.now()) {
  const d = codexDir(); if (!fs.existsSync(d)) return { tool: 'openai-codex', found: false, note: `No Codex CLI sessions found (${d}).` };
  const files = walk(d, [], 0, now - 8 * DAY).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  let snap = null, snapTs = 0, tokens7 = 0;
  for (const f of files) for (const j of lines(f)) {
    const p = j.payload; if (!p || p.type !== 'token_count') continue; const ts = Date.parse(j.timestamp) || 0;
    if (p.rate_limits && ts >= snapTs) { snap = p.rate_limits; snapTs = ts; }
    if (ts >= now - 7 * DAY) tokens7 += (p.info?.last_token_usage?.input_tokens || 0) + (p.info?.last_token_usage?.output_tokens || 0);
  }
  if (!snap) return { tool: 'openai-codex', found: true, files: files.length, state: 'fine', estimate: true, basis: 'no rate-limit snapshot in recent sessions', resets: [] };
  const low = (cfg.thresholds?.['openai-codex']?.low_percent) || 80;
  const wins = ['primary', 'secondary'].map(k => snap[k]).filter(Boolean).map(w => { const at = typeof w.resets_at === 'number' ? w.resets_at * 1000 : null; const expired = at && at <= now;
    return { kind: w.window_minutes === 300 ? '5h' : w.window_minutes === 10080 ? 'weekly' : `${w.window_minutes} min`, used_percent: expired ? 0 : w.used_percent, raw_used_percent: w.used_percent, reset_at: at ? new Date(at).toISOString() : null, expired }; });
  let state = 'fine'; const basis = [];
  const wk = wins.find(w => w.kind === 'weekly'), sh = wins.find(w => w.kind === '5h');
  if (wk && wk.used_percent >= 100) { state = 'weekly_hit'; basis.push('weekly window at 100% (server-reported)'); }
  else if (sh && sh.used_percent >= 100) { state = 'session_hit'; basis.push('5h window at 100% (server-reported)'); }
  else if (wins.some(w => w.used_percent >= low)) { state = 'low'; basis.push(`a window is at or above ${low}% (server-reported)`); }
  else basis.push('all windows below ' + low + '% (server-reported)');
  if (snap.rate_limit_reached_type && state === 'fine') { state = 'session_hit'; basis.push('rate_limit_reached_type=' + snap.rate_limit_reached_type); }
  return { tool: 'openai-codex', found: true, files: files.length, plan_type: snap.plan_type || null, state, estimate: false, basis: basis.join('; '), snapshot_at: new Date(snapTs).toISOString(), snapshot_age_min: Math.round((now - snapTs) / 6e4), windows: wins, tokens_7d: tokens7, resets: wins.filter(w => w.reset_at && !w.expired).map(w => ({ window: w.kind, at: w.reset_at })) };
}
// Build the plan list: config plans (slug -> "auto" | state) or auto-detected defaults.
export function myPlans(cfg, det, now = Date.now()) {
  const out = [], notes = [];
  const auto = { 'claude-code': det.claude, 'openai-codex': det.codex };
  let plans = cfg.plans;
  if (!plans || typeof plans !== 'object') {
    plans = {}; if (det.claude.found) { plans['claude-pro'] = 'auto'; notes.push('Assumed Claude Pro (set your real plan in ~/.planlimits.json).'); }
    if (det.codex.found) { const pt = det.codex.plan_type; const s = pt === 'pro' ? 'codex-pro' : pt === 'go' ? 'codex-go' : 'codex-plus'; plans[s] = 'auto'; notes.push(pt ? `Codex plan from your logs: ${pt}.` : 'Assumed Codex Plus.'); }
  }
  for (const [slug, v] of Object.entries(plans)) {
    const tool = slug.startsWith('claude-') ? 'claude-code' : slug.startsWith('codex-') ? 'openai-codex' : null;
    if (v === 'auto') { const d = tool && auto[tool]; if (d && d.found) out.push({ plan: slug, state: d.state, source: 'auto', detail: d }); else { out.push({ plan: slug, state: 'fine', source: 'manual-default', detail: { basis: 'auto-detect not available for this tool here; defaulted to fine' } }); notes.push(`${slug}: no local logs, so "fine" was assumed. Set a manual state in ~/.planlimits.json.`); } }
    else out.push({ plan: slug, state: String(v), source: 'manual', detail: { basis: 'manual state from ~/.planlimits.json' } });
  }
  return { plans: out, notes };
}
