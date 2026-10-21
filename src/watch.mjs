// planlimits watch: alert when a 5-hour or weekly window reaches a threshold (default 80%).
// Codex: server-reported used_percent from your local Codex logs. Claude Code: ESTIMATE only, from your own
// token thresholds in ~/.planlimits.json (Anthropic publishes no token limits), plus any "limit reached" message in your logs.
import path from 'path'; import { spawnSync } from 'child_process'; import { createRequire } from 'module';
import { gather } from './core.mjs';
export function windowsOf(g) {
  const out = [], notes = [];
  for (const p of g.plans) { const d = p.detail || {};
    if (d.tool === 'openai-codex' && d.windows) for (const w of d.windows) out.push({ plan: p.plan, window: w.kind, percent: w.used_percent, reset_at: w.reset_at, basis: `server-reported by OpenAI in your Codex log, ${d.snapshot_age_min} min old`, estimate: false });
    if (d.tool === 'claude-code') {
      const th = g.cfg.thresholds?.['claude-code'] || {}; const r5 = (d.resets || []).find(r => /5h/.test(r.window));
      if (p.state === 'session_hit' && !d.estimate) out.push({ plan: p.plan, window: '5h', percent: 100, reset_at: r5?.at || null, basis: 'limit message in your Claude Code log', estimate: false });
      else if (th.session_tokens) out.push({ plan: p.plan, window: '5h', percent: Math.round(d.session_tokens / th.session_tokens * 100), reset_at: d.block_start ? r5?.at || null : null, basis: `${d.session_tokens} tokens vs your own threshold ${th.session_tokens}`, estimate: true });
      if (p.state === 'weekly_hit') out.push({ plan: p.plan, window: 'weekly', percent: 100, reset_at: (d.resets || []).find(r => /weekly/.test(r.window))?.at || null, basis: 'weekly limit message in your Claude Code log', estimate: false });
      else if (th.weekly_tokens) out.push({ plan: p.plan, window: 'weekly', percent: Math.round(d.weekly_tokens_7d / th.weekly_tokens * 100), reset_at: null, basis: `${d.weekly_tokens_7d} tokens in 7 days vs your own threshold ${th.weekly_tokens}`, estimate: true });
      if (!th.session_tokens && !th.weekly_tokens) notes.push(`${p.plan}: Anthropic publishes no token limits, so percentages need your own thresholds (thresholds.claude-code.session_tokens / weekly_tokens in ~/.planlimits.json). Until then only "limit reached" messages in your logs trigger an alert.`);
    } }
  return { windows: out, notes };
}
let notifier;
function loadNotifier() {
  if (notifier !== undefined) return notifier; notifier = null;
  const tries = [process.cwd()]; try { const r = spawnSync('npm', ['root', '-g'], { encoding: 'utf8', timeout: 5000 }); if (r.stdout) tries.push(r.stdout.trim()); } catch {}
  for (const base of tries) { try { notifier = createRequire(path.join(base, 'noop.js'))('node-notifier'); break; } catch {} }
  return notifier;
}
function alert(msg, { desktop }) {
  const line = `[${new Date().toLocaleTimeString()}] ALERT ${msg}`;
  process.stdout.write('\x07' + line + '\n');
  if (desktop && loadNotifier()) { try { notifier.notify({ title: 'PlanLimits', message: msg }); return 'desktop+terminal'; } catch {} }
  return 'terminal';
}
export async function watch({ threshold = 80, interval = 60, once = false, desktop = true, json = false, log = console.log } = {}) {
  const fired = new Set(); let shownNotes = false;
  const tick = () => {
    const g = gather(); const { windows, notes } = windowsOf(g); const alerts = [];
    if (!shownNotes) { for (const n of [...notes, ...g.notes]) log('note: ' + n); shownNotes = true; if (desktop && !json && !loadNotifier()) log('note: node-notifier not found, so alerts go to this terminal (with a bell). For desktop popups: npm i -g node-notifier'); }
    for (const w of windows) {
      const level = w.percent >= 100 ? 100 : w.percent >= threshold ? threshold : 0; if (!level) continue;
      const key = `${w.plan}|${w.window}|${w.reset_at || 'na'}|${level}`; if (fired.has(key)) continue; fired.add(key);
      const msg = `${w.plan} ${w.window} window at ${w.percent}%${w.estimate ? ' (estimate)' : ''}${w.reset_at ? ', resets ' + new Date(w.reset_at).toLocaleString() : ''}. Basis: ${w.basis}.`;
      alerts.push({ ...w, level, message: msg, via: json ? 'json' : alert(msg, { desktop }) });
    }
    if (json) log(JSON.stringify({ checked_at: new Date().toISOString(), threshold, windows, alerts, notes }, null, 1));
    else if (!alerts.length) log(`[${new Date().toLocaleTimeString()}] ok: ${windows.length ? windows.map(w => `${w.plan} ${w.window} ${w.percent}%${w.estimate ? '~' : ''}`).join(', ') : 'no windows to watch'} (alert at ${threshold}%)`);
    return alerts;
  };
  const first = tick(); if (once) return first;
  log(`watching every ${interval}s; Ctrl+C to stop`);
  return new Promise(() => setInterval(tick, interval * 1000));
}
