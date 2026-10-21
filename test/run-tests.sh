#!/bin/bash
# Local test harness: temp HOMEs only. Never touches the real ~/.claude or ~/.codex.
set -u; CLI="node $(cd "$(dirname "$0")/.." && pwd)/bin/planlimits.mjs"; FX="node $(dirname "$0")/make-fixtures.mjs"; pass=0; fail=0
ok(){ if eval "$2"; then echo "PASS: $1"; pass=$((pass+1)); else echo "FAIL: $1"; fail=$((fail+1)); fi; }
echo "== 1. Claude limit message + Codex weekly 85% (low)"; T=$(mktemp -d); $FX $T claude-limit >/dev/null
OUT=$(HOME=$T $CLI status); echo "$OUT"
ok "claude session_hit from limit message" 'echo "$OUT" | grep -q "^claude-pro *session_hit"'
ok "codex low at 85% weekly" 'echo "$OUT" | grep -q "^codex-plus *low"'
echo "== 2. Codex weekly 100%"; T2=$(mktemp -d); $FX $T2 codex-weekly-hit >/dev/null; OUT=$(HOME=$T2 $CLI status); echo "$OUT" | head -4
ok "codex weekly_hit" 'echo "$OUT" | grep -q "^codex-plus *weekly_hit"'
ok "duplicate message ignored (30 unique x 4,400 = 132000 tokens)" 'echo "$OUT" | grep -q "5h tokens 132000"'
echo "== 3. Config: thresholds + manual states"; T3=$(mktemp -d); $FX $T3 mixed >/dev/null
echo '{"plans":{"claude-max-5x":"auto","codex-plus":"auto","cursor-premium":"low","copilot-pro":"fine"},"thresholds":{"claude-code":{"session_tokens":150000,"low_ratio":0.8}}}' > $T3/.planlimits.json
OUT=$(HOME=$T3 $CLI status); echo "$OUT"
ok "claude low vs own threshold (132000 >= 0.8*150000)" 'echo "$OUT" | grep -q "^claude-max-5x *low"'
ok "manual cursor state" 'echo "$OUT" | grep -q "^cursor-premium *low *manual"'
ROUT=$(HOME=$T3 $CLI route --offline --task quick); echo "$ROUT" | head -3
ok "route offline works" 'echo "$ROUT" | grep -q "^Use "'
echo "== 4. Bad config JSON"; T4=$(mktemp -d); echo '{bad' > $T4/.planlimits.json; OUT=$(HOME=$T4 $CLI status); echo "$OUT" | tail -2
ok "invalid config reported" 'echo "$OUT" | grep -q "INVALID JSON"'
echo "== 5. No logs, no config"; T5=$(mktemp -d); OUT=$(HOME=$T5 $CLI route --offline 2>&1); echo "$OUT"
ok "no plans -> clear error" 'echo "$OUT" | grep -q "No plans found"'
echo "== 6. MCP over stdio"; MC=$(printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_my_usage","arguments":{}}}' '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"route_me","arguments":{"task":"refactor","offline":true}}}' | HOME=$T3 timeout 10 $CLI mcp --offline); echo "$MC" | cut -c1-300
ok "mcp initialize" 'echo "$MC" | grep -q "\"serverInfo\""'
ok "mcp tools/list has both tools" 'echo "$MC" | grep -q get_my_usage && echo "$MC" | grep -q route_me'
ok "mcp route_me returns summary" 'echo "$MC" | grep "\"id\":4" | grep -q "Use "'
echo "== 7. Hook install/uninstall (temp HOME, existing settings preserved)"; T6=$(mktemp -d); mkdir -p $T6/.claude; echo '{"model":"opus","hooks":{"Stop":[{"hooks":[{"type":"command","command":"notify-send done"}]}]}}' > $T6/.claude/settings.json; cp $T6/.claude/settings.json $T6/orig.json
OUT=$(HOME=$T6 $CLI hook install claude-code </dev/null); echo "$OUT" | tail -1
ok "no TTY + no --yes -> cancelled, unchanged" 'cmp -s $T6/.claude/settings.json $T6/orig.json'
OUT=$(HOME=$T6 $CLI hook install claude-code --yes); echo "$OUT" | tail -2
ok "installed, other hook + model kept" 'node -e "const s=require(\"$T6/.claude/settings.json\");process.exit(s.model===\"opus\"&&s.hooks.Stop.length===2&&JSON.stringify(s).includes(\"planlimits-hook-run\")?0:1)"'
ok "backup written" 'ls $T6/.claude/settings.json.planlimits-backup-* >/dev/null 2>&1'
OUT=$(HOME=$T6 $CLI hook install claude-code --yes); ok "idempotent" 'echo "$OUT" | grep -q "already installed"'
echo "== 8. Hook run (limit hit -> systemMessage + handoff)"; $FX $T6 claude-limit >/dev/null
HC=$(node -e "console.log(require('$T6/.claude/settings.json').hooks.Stop[1].hooks[0].command)"); echo "hook command: $HC"
HO=$(echo '{"session_id":"s1","cwd":"/home/dev/myapp","hook_event_name":"Stop","last_assistant_message":"Refactored auth/login.ts; tests still failing in auth.spec.ts"}' | HOME=$T6 bash -c "$HC"); echo "$HO"
ok "systemMessage printed" 'echo "$HO" | grep -q systemMessage'
ok "handoff written" 'grep -q "auth.spec.ts" $T6/.planlimits/handoff.md'
HP=$(HOME=$T6 $CLI handoff codex --print); ok "handoff codex --print" 'echo "$HP" | grep -q "^codex "'
FO=$(echo '{}' | HOME=$T2 bash -c "$HC"); ok "hook prints nothing when Claude is fine" '[ -z "$FO" ]'
OUT=$(HOME=$T6 $CLI hook uninstall claude-code --yes); echo "$OUT" | head -1
ok "uninstall restores original content" 'node -e "const a=require(\"$T6/.claude/settings.json\"),b=require(\"$T6/orig.json\");process.exit(JSON.stringify(a)===JSON.stringify(b)?0:1)"'
echo "== 9. Bad settings JSON is never overwritten"; T7=$(mktemp -d); mkdir -p $T7/.claude; echo '{oops' > $T7/.claude/settings.json; OUT=$(HOME=$T7 $CLI hook install claude-code --yes 2>&1); ok "refuses invalid settings" 'grep -q oops $T7/.claude/settings.json && echo "$OUT" | grep -q Refusing'
echo "== 10. watch (alerts at threshold; Claude estimate labeled)"
W=$(HOME=$T $CLI watch --once --no-desktop); WC=$?; echo "$W"
ok "watch --once exits 2 when alerting" '[ $WC = 2 ]'
ok "codex weekly 85% alert (server-reported)" 'echo "$W" | grep -q "ALERT codex-plus weekly window at 85%.*server-reported"'
ok "claude limit message -> 100% alert" 'echo "$W" | grep -q "ALERT claude-pro 5h window at 100%"'
ok "no-threshold note for Claude" 'echo "$W" | grep -q "publishes no token limits"'
WD=$(HOME=$T NODE_PATH=/nonexistent $CLI watch --once 2>&1); ok "desktop on + no node-notifier -> terminal fallback note" 'echo "$WD" | grep -q "node-notifier not found" && echo "$WD" | grep -q "ALERT"'
W=$(HOME=$T3 $CLI watch --once --no-desktop --threshold 86); echo "$W"
ok "claude % vs own threshold labeled estimate" 'echo "$W" | grep -q "claude-max-5x 5h window at 88% (estimate)"'
ok "codex 85% below 86 threshold -> no codex alert" '! echo "$W" | grep -q "ALERT codex-plus"'
W=$(HOME=$T5 $CLI watch --once --no-desktop); WC=$?; ok "nothing to watch -> exit 0" '[ $WC = 0 ] && echo "$W" | grep -q "no windows to watch"'
WJ=$(HOME=$T $CLI watch --once --json); ok "watch --json parses" 'echo "$WJ" | node -e "let s=\"\";process.stdin.on(\"data\",d=>s+=d).on(\"end\",()=>{const j=JSON.parse(s.slice(s.indexOf(\"{\")));process.exit(j.alerts.length===2?0:1)})"'
HOME=$T $CLI watch --threshold 0 >/dev/null 2>&1; ok "bad threshold rejected" '[ $? = 1 ]'
echo "== RESULT: $pass passed, $fail failed"; [ $fail = 0 ]
