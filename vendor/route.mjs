// Shared routing logic for /router/ (inlined into the page by build.mjs), /api/v1/route and the MCP route_task tool.
// Pure function: uses only the sourced data passed in (data/plans.json). No invented limits.
export const ROUTE_STATES = { fine: 'Fine / plenty left', low: 'Running low (~80% of the main limit used)', session_hit: 'Hit the short (session/daily) limit', exhausted: 'Hit the main (weekly/monthly) limit' };
export const STATE_ALIASES = { weekly_hit: 'exhausted', monthly_hit: 'exhausted' };
export const ROUTE_TASKS = { refactor: 'Big refactor / long agent run', everyday: 'Everyday edits', quick: 'Quick questions' };
const SHORT = { 'claude-code': 'claude', 'openai-codex': 'codex', 'github-copilot': 'copilot', 'gemini-cli': 'gemini' };
export function planSlug(toolId, planName) { return (SHORT[toolId] || toolId) + '-' + planName.toLowerCase().replace(/\+/g, '-plus').replace(/[^a-z0-9]+/g, '-').replace(/-+$/, ''); }
export function routablePlans(PLANS) {
  return PLANS.tools.flatMap(t => t.plans.filter(p => p.codingAccess !== false && !/user|seat|team/i.test(p.priceNote + p.name))
    .map(p => ({ slug: planSlug(t.id, p.name), tool_id: t.id, tool: t.name, plan: p.name, price: p.price, price_note: p.priceNote, limits: p.limits, window: p.window, source_url: p.source, checked: p.checked, limit_model: t.limitModel })));
}
// Reset text built only from the sourced window / limit model strings.
function resets(p) {
  const w = p.window || '', out = [];
  if (/5-hour/i.test(w)) out.push(/currently off/i.test(w) ? '5-hour window: currently off per vendor' : 'Session: rolling 5-hour window');
  if (/daily/i.test(w)) out.push('Daily quota: resets daily (exact time not published)');
  if (/weekly/i.test(w)) out.push(/Max's weekly limit resets at a fixed time/i.test(p.limit_model) ? 'Weekly: fixed weekly time per account (see your usage page)' : 'Weekly: resets weekly (exact time not published; check your usage page)');
  if (/monthly/i.test(w)) { const m = (p.limit_model || '').match(/Resets ([^.]+)/i); out.push('Monthly: ' + (m ? 'resets ' + m[1] : 'resets monthly (exact time not published)')); }
  if (!out.length) out.push('Reset window: not published');
  return out;
}
const hasShort = p => /5-hour|daily/i.test(p.window || '') && !/5-hour limit currently|currently off/i.test(p.window || '');
const mainWin = p => /monthly/i.test(p.window) ? 'monthly' : /weekly/i.test(p.window) ? 'weekly' : /daily/i.test(p.window) ? 'daily' : /5-hour/i.test(p.window) ? '5-hour' : 'unknown';
export function parsePlansParam(s) { return String(s || '').split(',').map(x => x.trim()).filter(Boolean).map(x => { const [plan, state] = x.split(':'); return { plan, state: state || 'fine' }; }); }
export function route(PLANS, input) {
  const all = routablePlans(PLANS), errors = [];
  const warnings = [];
  const task = ROUTE_TASKS[input?.task] ? input.task : 'everyday';
  if (input?.task && !ROUTE_TASKS[input.task]) errors.push(`Unknown task "${String(input.task).slice(0, 40)}". Valid: ${Object.keys(ROUTE_TASKS).join(', ')}`);
  const seen = new Set(), owned = [];
  for (const o of (Array.isArray(input?.plans) ? input.plans : []).slice(0, 12)) {
    const p = all.find(x => x.slug === o?.plan); if (!p) { errors.push(`Unknown plan "${String(o?.plan).slice(0, 40)}"`); continue; }
    if (seen.has(p.slug)) continue; seen.add(p.slug);
    const raw = o.state == null || o.state === '' ? 'fine' : String(o.state); const st0 = STATE_ALIASES[raw] || raw;
    if (!ROUTE_STATES[st0]) { errors.push(`Unknown state "${raw.slice(0, 40)}" for ${p.slug}. Valid: ${[...Object.keys(ROUTE_STATES), ...Object.keys(STATE_ALIASES)].join(', ')}`); continue; }
    let st = st0;
    if (st === 'session_hit' && !hasShort(p)) { st = 'exhausted'; warnings.push(`${p.slug} has no published short (session/daily) window, so "session_hit" was treated as "exhausted".`); }
    owned.push({ ...p, state: st, resets: resets(p), main_window: mainWin(p) });
  }
  const dc = checkedRange(PLANS);
  if (errors.length || !owned.length) return { ok: false, error: errors.length ? 'Invalid input: ' + errors.join(' | ') : 'Pick at least one plan you have.', errors, ...dc, valid_plans: all.map(p => p.slug), valid_states: Object.keys(ROUTE_STATES), valid_tasks: Object.keys(ROUTE_TASKS) };
  const avail = owned.filter(p => p.state === 'fine' || p.state === 'low');
  const sc = p => (p.state === 'fine' ? 2 : 1) * 1000 + (task === 'quick' ? -(p.price || 0) : (p.price || 0)) + (task === 'everyday' && hasShort(p) ? 500 : 0);
  avail.sort((a, b) => sc(b) - sc(a));
  const name = p => `${p.tool} ${p.plan}`;
  const why = p => {
    const r = [`state: ${ROUTE_STATES[p.state].toLowerCase()}`];
    if (p.state === 'session_hit') r.push('back after its short window resets: ' + p.resets[0]);
    if (p.state === 'exhausted') r.push('back after its main limit resets: ' + p.resets[p.resets.length - 1]);
    if (p.state === 'fine' || p.state === 'low') { if (task === 'refactor') r.push(`highest-priced plan you have with room left (estimate: vendors don't publish comparable units, so price is used as a rough proxy for headroom)`);
    if (task === 'quick') r.push(`cheapest plan with room left, saving bigger plans for heavier work (estimate)`);
    if (task === 'everyday' && hasShort(p)) r.push(`its short window resets soon, so using it now wastes less`);
    } r.push(`stated limits: ${p.limits}`); return r.join('; ');
  };
  const soonest = [...owned].sort((a, b) => (a.state === 'session_hit' ? 0 : 1) - (b.state === 'session_hit' ? 0 : 1) || (hasShort(b) ? 1 : 0) - (hasShort(a) ? 1 : 0));
  let rec, fb, summary;
  if (avail.length) { rec = avail[0]; fb = avail[1] || soonest.find(p => p !== rec && p.state === 'session_hit') || null;
    summary = `Use ${name(rec)} now.` + (fb ? ` When it runs out, switch to ${name(fb)}.` : ' You have no other plan with room left; when it runs out, wait for a reset or use pay-as-you-go/extra usage.'); }
  else { rec = null; fb = soonest[0];
    summary = `All your plans are out. ` + (fb.state === 'session_hit' ? `${name(fb)} should be back first (${fb.resets[0]}).` : `Each comes back when its main limit resets (${owned.map(p => name(p) + ': ' + p.resets[p.resets.length - 1]).join('; ')}); where an exact time isn't published, check that tool's usage page.`) + ` Meanwhile use the vendor's extra usage / credits or API if you need to keep going.`; }
  const out = p => p && ({ plan: p.slug, name: name(p), state: p.state, why: why(p), resets: p.resets, source_url: p.source_url, checked: p.checked });
  const cheapest = [...owned].sort((a, b) => (a.price ?? 0) - (b.price ?? 0))[0];
  const cost_note = rec && cheapest && rec !== cheapest && (rec.price ?? 0) > (cheapest.price ?? 0) ? `${name(rec)} (${rec.price_note}) costs more than your cheapest plan, ${name(cheapest)} (${cheapest.price_note}). You already pay for both, so using it adds no cost.` : null;
  return { ok: true, task, ...dc, summary, cost_note, recommendation: out(rec), fallback: out(fb),
    plans: owned.map(p => ({ plan: p.slug, name: name(p), state: p.state, main_window: p.main_window, resets: p.resets, stated_limits: p.limits, source_url: p.source_url, checked: p.checked })),
    rotation: rotation(owned), warnings, notes: ['Reset times come from each vendor\'s stated window; exact weekly reset times are per account and not published.', 'Rankings that use price as a proxy for headroom are estimates. Vendors do not publish comparable usage units.'], errors };
}
// Suggested weekly rotation (estimate). Weekly-capped plans get contiguous day blocks so each one's cap stretches across the week;
// monthly plans are steady backups; plans with short (5-hour/daily) windows absorb overflow every day.
export function checkedRange(PLANS) { const d = [PLANS.checked, ...PLANS.tools.flatMap(t => [t.checked, ...t.plans.map(p => p.checked)])].filter(Boolean).sort(); return { data_checked: d[0], data_checked_oldest: d[0], data_checked_newest: d[d.length - 1] }; }
export function rotation(owned) {
  const days = ['Today', 'Tomorrow', 'Day 3', 'Day 4', 'Day 5', 'Day 6', 'Day 7'];
  const nm = p => `${p.tool} ${p.plan}`, ok = p => p.state === 'fine' || p.state === 'low';
  const usable = owned.filter(ok), out = owned.filter(p => !ok(p));
  const shortName = p => /5-hour/i.test(p.window) ? '5h' : /daily/i.test(p.window) ? 'daily' : 'short';
  const back = p => p.state === 'session_hit' ? `${nm(p)} back after its ${shortName(p)} reset` : `${nm(p)} back after its ${p.main_window === 'unknown' ? '' : p.main_window + ' '}reset${p.main_window === 'weekly' ? ' (day not published)' : ''}`;
  const backTxt = out.length ? out.map(back).join('; ') : '';
  let lead = usable.filter(p => p.main_window === 'weekly').sort((a, b) => (b.price || 0) - (a.price || 0));
  let leadWhy = 'weekly-capped plan with room left; days split in proportion to price (estimate) so each weekly cap is spread across the week';
  if (!lead.length) { lead = [...usable].sort((a, b) => (b.price || 0) - (a.price || 0)); leadWhy = 'plan with room left; days split in proportion to price (estimate)'; }
  const outNote = out.map(p => `${nm(p)} is not primary until it resets: ${p.state === 'session_hit' ? 'it hit its short window; use it as a backup after ' + p.resets[0].toLowerCase() : 'it hit its main limit; it returns after ' + p.resets[p.resets.length - 1].toLowerCase()}.`);
  if (!lead.length && owned.some(p => p.state === 'session_hit')) {
    const later = rotation(owned.map(p => p.state === 'session_hit' ? { ...p, state: 'fine' } : p));
    const sess = owned.filter(p => p.state === 'session_hit');
    return { ...later, schedule: [{ day: days[0], primary: 'none until a reset', backup: sess.map(nm).join(', '), why: `No plan has room left today. ${backTxt}.` }, ...later.schedule.slice(1)],
      explain: `Nothing has room today. From tomorrow, ${sess.map(nm).join(', ')} ${sess.length > 1 ? 'are' : 'is'} usable again after the ${sess.map(shortName).join('/')} reset. ` + later.explain.replace('Starts today. ', ''), tips: outNote.concat(later.tips.filter(t => !/is not primary/.test(t))) };
  }
  if (!lead.length) { const sess = owned.filter(p => p.state === 'session_hit');
    return { label: 'Suggestion (estimate), not a vendor rule', schedule: days.map(d => ({ day: d, primary: 'none until a reset', backup: sess.map(nm).join(', ') || 'none', why: `No plan has room left. ${backTxt}.` })), explain: 'Every plan you picked is out, so no plan is primary until one resets; see the reset times above.', tips: outNote }; }
  const tot = lead.reduce((s, p) => s + Math.max(p.price || 0, 1), 0); let acc = 0; const blocks = [];
  lead.forEach((p, i) => { acc += Math.max(p.price || 0, 1); blocks.push(i === lead.length - 1 ? 7 : Math.min(7, Math.max(Math.round(acc / tot * 7), (blocks[i - 1] || 0) + 1))); });
  const others = [...usable.filter(p => !lead.includes(p)).sort((a, b) => (b.price || 0) - (a.price || 0)), ...owned.filter(p => p.state === 'session_hit')];
  const tool = p => p.tool.split(' /')[0].split(' (')[0];
  const share = (p, n, k) => p.main_window === 'weekly' ? (n === 1 ? 'its whole weekly budget is yours today (estimate)' : `about 1/${n} of its weekly budget today, ~${k}/${n} used by tonight (estimate)`) : p.main_window === 'monthly' ? 'about 1/30 of its monthly allowance today (estimate)' : p.main_window === 'daily' ? 'its daily quota' : 'share not published';
  return { label: 'Suggestion (estimate), not a vendor rule', schedule: days.map((d, i) => { let li = blocks.findIndex(b => i < b); if (li < 0) li = lead.length - 1; const p = lead[li];
      const start = blocks[li - 1] || 0, n = blocks[li] - start, k = i - start + 1;
      const fbs = [...lead.filter(x => x !== p), ...others];
      const okDay = x => ok(x) || (i > 0 && x.state === 'session_hit');
      const fbUsable = fbs.find(okDay), fbSess = fbs.find(x => x.state === 'session_hit');
      const parts = [`${nm(p)}: ${share(p, n, k)}`];
      if (fbUsable) parts.push(`${nm(fbUsable)} if ${tool(p)} runs dry`);
      else if (fbSess) parts.push(`${nm(fbSess)} as backup after its ${shortName(fbSess)} reset`);
      else parts.push('no other plan with room left; use extra usage/credits if it runs dry');
      const backDay = out.filter(x => !(i > 0 && x.state === 'session_hit')).map(back).join('; ');
      if (backDay) parts.push(backDay);
      if (i === 1) out.filter(x => x.state === 'session_hit').forEach(x => parts.push(`${nm(x)} usable again (its ${shortName(x)} session has reset)`));
      let pre = '';
      if (k === 1 && li > 0) pre = `Switch day (${tool(lead[li - 1])} → ${tool(p)}). `;
      if (k === n && li < lead.length - 1) parts.push(`switch to ${nm(lead[li + 1])} tomorrow`);
      return { day: d, primary: nm(p), backup: fbs.map(x => x.state === 'session_hit' && i === 0 ? `${nm(x)} (after its ${shortName(x)} reset)` : nm(x)).join(', ') || 'none', why: pre + parts.join('; ') + '.' }; }),
    explain: `Starts today. Each primary is a ${leadWhy}. Plans that hit a weekly/monthly limit stay off primary until they reset; plans that only hit a 5-hour/daily limit are back as backups from tomorrow.`,
    tips: [...usable.filter(hasShort).map(p => `${nm(p)}: when its 5-hour/daily limit hits, switch, then come back after the reset.`),
      ...usable.filter(p => p.main_window === 'monthly').map(p => `${nm(p)}: monthly allowance; pace it at about a quarter per week (estimate).`), ...outNote] };
}
