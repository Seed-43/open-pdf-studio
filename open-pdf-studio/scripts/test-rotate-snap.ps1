# Rotate + object-snap regression test — guards for the 'RO' rotate session
# (g-rotate-mode.js / applyRotateGeneric) and the G-move corner object snap.
#
# Tests:
#   T1  RO on a box        -> rotation field becomes 90, anchor unchanged
#   T2  RO on a line       -> endpoints rotate 90 degrees around the centre
#   T3  Escape during RO   -> nothing changes
#   T4  G-move object snap -> a CORNER of the moved box clicks exactly onto a
#                             line endpoint when released within snap radius
#   T5  G-move far field   -> plain move stays exact (snap does not distort)
#
# Requires a test instance with the MCP server, started headless so its
# window stays off-screen and never takes focus (OPDS_HEADLESS=1, see
# src-tauri/src/headless.rs):
#   $env:OPDS_DETACHED=1; $env:OPS_ENABLE_MCP=1; $env:OPDS_HEADLESS=1
#   open-pdf-studio.exe --mcp-server --mcp-port 9224
#
# Usage: powershell -File scripts/test-rotate-snap.ps1

$base = 'http://127.0.0.1:9224/mcp'
$script:n = 7000
function Call($name, $toolArgs) {
  $script:n++
  $b = @{jsonrpc='2.0'; id=$script:n; method='tools/call'; params=@{name=$name; arguments=$toolArgs}} | ConvertTo-Json -Depth 14
  $r = Invoke-RestMethod -Uri $base -Method Post -ContentType 'application/json' -Body $b -TimeoutSec 25
  if (-not $r.result.content) { throw "MCP error: $($r | ConvertTo-Json -Compress)" }
  $r.result.content[0].text | ConvertFrom-Json
}

$results = [ordered]@{}
function Assert($name, $ok, $detail) {
  $results[$name] = @{ok=[bool]$ok; detail=$detail}
  $tag = if ($ok) { 'PASS' } else { 'FAIL' }
  "{0,-28} {1}  {2}" -f $name, $tag, $detail
}

$null = Call 'app_new_blank_pdf' @{widthPt=842; heightPt=595}
Start-Sleep -Milliseconds 500
$vp = Call 'app_get_viewport_state' @{}
$zoom = $vp.viewport.zoom; $ox = $vp.viewport.offsetX; $oy = $vp.viewport.offsetY
$cl = $vp.canvas.cssLeft; $ct = $vp.canvas.cssTop
function ClientX($ax) { $ax * $zoom + $ox + $cl }
function ClientY($ay) { $ay * $zoom + $oy + $ct }
function MoveTo($ax, $ay) { $null = Call 'app_mouse_move' @{x=(ClientX $ax); y=(ClientY $ay)} }
function ClickAt($ax, $ay) { $null = Call 'app_mouse_click' @{x=(ClientX $ax); y=(ClientY $ay)} }

# Chord helper: cursor to angle-reference point FIRST, then the chord, then
# the SAME point again (re-seeds the reference when the tracker went stale
# between RPCs — same methodology as the move-sweep).
function StartRotate($ax, $ay) {
  MoveTo $ax $ay
  $null = Call 'app_key' @{key='r'}
  $null = Call 'app_key' @{key='o'}
  MoveTo $ax $ay
}

# ── T1: box — rotation field, anchor stays ──────────────────────────────
$box = Call 'app_create_annotation' @{type='box'; page=1; props=@{x=200; y=200; width=100; height=60}}
$null = Call 'app_select_annotation' @{id=$box.id}
# pivot = (250, 230); angle 0 reference right of it, then 90 degrees down
StartRotate 400 230
MoveTo 250 380
ClickAt 250 380
Start-Sleep -Milliseconds 300
$a = (Call 'app_get_annotation' @{id=$box.id}).annotation
Assert 'T1 box rotation=90' ($a.rotation -eq 90 -and [Math]::Abs($a.x - 200) -lt 0.5 -and [Math]::Abs($a.y - 200) -lt 0.5) "rotation=$($a.rotation) x=$([Math]::Round($a.x,2)) y=$([Math]::Round($a.y,2))"

# ── T2: line — endpoints rotate around the centre ───────────────────────
$ln = Call 'app_create_annotation' @{type='line'; page=1; props=@{startX=300; startY=450; endX=400; endY=450}}
$null = Call 'app_select_annotation' @{id=$ln.id}
# pivot = (350, 450)
StartRotate 470 450
MoveTo 350 570
ClickAt 350 570
Start-Sleep -Milliseconds 300
$a = (Call 'app_get_annotation' @{id=$ln.id}).annotation
$t2ok = ([Math]::Abs($a.startX - 350) -lt 1) -and ([Math]::Abs($a.startY - 400) -lt 1) -and
        ([Math]::Abs($a.endX - 350) -lt 1) -and ([Math]::Abs($a.endY - 500) -lt 1)
Assert 'T2 line rotated 90' $t2ok "start=($([Math]::Round($a.startX,2)),$([Math]::Round($a.startY,2))) end=($([Math]::Round($a.endX,2)),$([Math]::Round($a.endY,2)))"

# ── T3: Escape cancels ──────────────────────────────────────────────────
$null = Call 'app_select_annotation' @{id=$box.id}
StartRotate 400 230
MoveTo 300 100
$null = Call 'app_key' @{key='Escape'}
Start-Sleep -Milliseconds 300
$a = (Call 'app_get_annotation' @{id=$box.id}).annotation
Assert 'T3 escape cancels' ($a.rotation -eq 90) "rotation=$($a.rotation) (moet 90 blijven)"

# ── T4: G-move object snap — box corner clicks onto line endpoint ───────
$null = Call 'app_new_blank_pdf' @{widthPt=842; heightPt=595}
Start-Sleep -Milliseconds 500
$box2 = Call 'app_create_annotation' @{type='box'; page=1; props=@{x=200; y=200; width=100; height=60}}
$ln2  = Call 'app_create_annotation' @{type='line'; page=1; props=@{startX=400; startY=300; endX=520; endY=360}}
$null = Call 'app_select_annotation' @{id=$box2.id}
# Move so the box's bottom-right corner (300,260) lands NEAR the line start
# (400,300): needed delta (100,40); release with a (-3,+3) error -> the
# object snap must correct it to exactly (100,40).
MoveTo 250 230
$null = Call 'app_key' @{key='g'}
MoveTo 250 230
MoveTo 347 273
ClickAt 347 273
Start-Sleep -Milliseconds 300
$a = (Call 'app_get_annotation' @{id=$box2.id}).annotation
$t4ok = ([Math]::Abs($a.x - 300) -lt 0.1) -and ([Math]::Abs($a.y - 240) -lt 0.1)
Assert 'T4 corner object snap' $t4ok "x=$([Math]::Round($a.x,2)) y=$([Math]::Round($a.y,2)) (verwacht exact 300,240)"

# ── T6: 'mv' base-point flow — pick own corner, drop on line endpoint ───
$box4 = Call 'app_create_annotation' @{type='box'; page=1; props=@{x=200; y=400; width=100; height=60}}
$null = Call 'app_select_annotation' @{id=$box4.id}
# Base pick NEAR the box's own bottom-right corner (300,460) with a (3,2)
# error -> snap must grab the exact corner. Then drop NEAR the line start
# (400,300) -> cursor snap -> corner lands exactly on the endpoint.
MoveTo 303 462
$null = Call 'app_key' @{key='m'}
$null = Call 'app_key' @{key='v'}
MoveTo 303 462
ClickAt 303 462          # click 1: snapped base point (300,460)
Start-Sleep -Milliseconds 200
MoveTo 402 302
ClickAt 402 302          # click 2: snapped drop point (400,300) -> delta (100,-160)
Start-Sleep -Milliseconds 300
$a = (Call 'app_get_annotation' @{id=$box4.id}).annotation
$t6ok = ([Math]::Abs($a.x - 300) -lt 0.1) -and ([Math]::Abs($a.y - 240) -lt 0.1)
Assert 'T6 mv base-point snap' $t6ok "x=$([Math]::Round($a.x,2)) y=$([Math]::Round($a.y,2)) (verwacht exact 300,240)"

# ── T7: 'mv' + typed ABSOLUTE coordinate ("=x,y") drops exactly there ───
$box7 = Call 'app_create_annotation' @{type='box'; page=1; props=@{x=200; y=400; width=100; height=60}}
$null = Call 'app_select_annotation' @{id=$box7.id}
MoveTo 303 462
$null = Call 'app_key' @{key='m'}
$null = Call 'app_key' @{key='v'}
MoveTo 303 462
ClickAt 303 462          # base point snaps to own corner (300,460)
Start-Sleep -Milliseconds 200
MoveTo 320 440           # any tracking move; the typed coord overrides it
foreach ($k in @('=','3','5','0',',','4','0','0')) { $null = Call 'app_key' @{key=$k} }
$null = Call 'app_key' @{key='Enter'}
Start-Sleep -Milliseconds 300
$a = (Call 'app_get_annotation' @{id=$box7.id}).annotation
$t7ok = ([Math]::Abs($a.x - 250) -lt 0.1) -and ([Math]::Abs($a.y - 340) -lt 0.1)
Assert 'T7 mv typed =x,y' $t7ok "x=$([Math]::Round($a.x,2)) y=$([Math]::Round($a.y,2)) (verwacht exact 250,340)"
$null = Call 'app_delete_annotation' @{id=$box7.id}

# ── T8: 'co' copy with base point — clone lands corner-on-endpoint ──────
$box8 = Call 'app_create_annotation' @{type='box'; page=1; props=@{x=200; y=100; width=100; height=60}}
$before = (Call 'app_list_annotations' @{}).count
$null = Call 'app_select_annotation' @{id=$box8.id}
MoveTo 250 130
$null = Call 'app_key' @{key='c'}
$null = Call 'app_key' @{key='o'}
Start-Sleep -Milliseconds 200
MoveTo 303 162
ClickAt 303 162          # base point on the CLONE's own corner (300,160)
Start-Sleep -Milliseconds 200
MoveTo 320 180           # any tracking move; the typed coord overrides it
foreach ($k in @('=','5','0','0',',','5','0','0')) { $null = Call 'app_key' @{key=$k} }
$null = Call 'app_key' @{key='Enter'}
Start-Sleep -Milliseconds 300
$after = Call 'app_list_annotations' @{}
$orig = (Call 'app_get_annotation' @{id=$box8.id}).annotation
# Base (300,160) -> typed end (500,500): delta (200,340) -> clone at (400,440)
$clone = $after.annotations | Where-Object { $_.type -eq 'box' -and $_.id -ne $box8.id -and [Math]::Abs($_.x - 400) -lt 0.5 -and [Math]::Abs($_.y - 440) -lt 0.5 } | Select-Object -First 1
$t8ok = ($after.count -eq $before + 1) -and ($null -ne $clone) -and
        ([Math]::Abs($orig.x - 200) -lt 0.1) -and ([Math]::Abs($orig.y - 100) -lt 0.1)
Assert 'T8 co base-point copy' $t8ok "count $before->$($after.count) orig=($([Math]::Round($orig.x,1)),$([Math]::Round($orig.y,1))) clone=$(if($clone){"($([Math]::Round($clone.x,1)),$([Math]::Round($clone.y,1)))"}else{'-'})"

# ── T5: far-field move stays exact ──────────────────────────────────────
$box3 = Call 'app_create_annotation' @{type='box'; page=1; props=@{x=600; y=100; width=60; height=40}}
$null = Call 'app_select_annotation' @{id=$box3.id}
MoveTo 630 120
$null = Call 'app_key' @{key='g'}
MoveTo 630 120
MoveTo 671 153
ClickAt 671 153
Start-Sleep -Milliseconds 300
$a = (Call 'app_get_annotation' @{id=$box3.id}).annotation
$t5ok = ([Math]::Abs($a.x - 641) -lt 1) -and ([Math]::Abs($a.y - 133) -lt 1)
Assert 'T5 plain move exact' $t5ok "x=$([Math]::Round($a.x,2)) y=$([Math]::Round($a.y,2)) (verwacht 641,133)"

""
$failed = @($results.GetEnumerator() | Where-Object { -not $_.Value.ok })
"{0}/{1} PASS" -f ($results.Count - $failed.Count), $results.Count
if ($failed.Count -gt 0) { exit 1 }
