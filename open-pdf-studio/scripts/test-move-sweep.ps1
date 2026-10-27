# Move-sweep regression test — THE guard for the edit-ops contract.
#
# For EVERY annotation type this script: creates one instance via the in-app
# MCP bridge, selects it, presses G, moves the cursor a known delta and
# clicks to commit — then verifies the annotation's anchor moved by exactly
# that delta. A new annotation type that breaks the generic move primitive
# (annotations/transforms.js applyMove) fails here immediately.
#
# Requires a test instance with the MCP server, started headless so its
# window stays off-screen and never takes focus (OPDS_HEADLESS=1, see
# src-tauri/src/headless.rs):
#   $env:OPDS_DETACHED=1; $env:OPS_ENABLE_MCP=1; $env:OPDS_HEADLESS=1
#   open-pdf-studio.exe --mcp-server --mcp-port 9224
#
# Usage: powershell -File scripts/test-move-sweep.ps1

$base = 'http://127.0.0.1:9224/mcp'
$script:n = 9000
function Call($name, $toolArgs) {
  $script:n++
  $b = @{jsonrpc='2.0'; id=$script:n; method='tools/call'; params=@{name=$name; arguments=$toolArgs}} | ConvertTo-Json -Depth 14
  $r = Invoke-RestMethod -Uri $base -Method Post -ContentType 'application/json' -Body $b -TimeoutSec 25
  if (-not $r.result.content) { throw "MCP error: $($r | ConvertTo-Json -Compress)" }
  $r.result.content[0].text | ConvertFrom-Json
}

# Anchor: first geometry field we can find — moved anchor must equal old+delta.
function Get-Anchor($ann) {
  if ($ann.startX -ne $null) { return @{x=$ann.startX; y=$ann.startY} }
  if ($ann.points) { return @{x=$ann.points[0].x; y=$ann.points[0].y} }
  if ($ann.path) { return @{x=$ann.path[0].x; y=$ann.path[0].y} }
  if ($ann.controlPoints) { return @{x=$ann.controlPoints[0].x; y=$ann.controlPoints[0].y} }
  if ($ann.point1) { return @{x=$ann.point1.x; y=$ann.point1.y} }
  if ($ann.x -ne $null) { return @{x=$ann.x; y=$ann.y} }
  return $null
}

$blank = Call 'app_new_blank_pdf' @{widthPt=842; heightPt=595}
$vp = Call 'app_get_viewport_state' @{}
$zoom = $vp.viewport.zoom; $ox = $vp.viewport.offsetX; $oy = $vp.viewport.offsetY
$cl = $vp.canvas.cssLeft; $ct = $vp.canvas.cssTop
function ClientX($ax) { $ax * $zoom + $ox + $cl }
function ClientY($ay) { $ay * $zoom + $oy + $ct }

# One spec per type: creation props. Anchor area ~ (100..300, 100..250).
$specs = [ordered]@{
  'line'        = @{type='line'; props=@{startX=100; startY=100; endX=220; endY=140}}
  'arrow'       = @{type='arrow'; props=@{startX=100; startY=160; endX=220; endY=200}}
  'wall'        = @{type='wall'; props=@{startX=100; startY=230; endX=240; endY=230; dikteMm=100; hatchPattern='nen47-metselwerk-baksteen'}}
  'box'         = @{type='box'; props=@{x=300; y=100; width=80; height=50}}
  'mask'        = @{type='mask'; props=@{x=300; y=100; width=80; height=50}}
  'circle'      = @{type='circle'; props=@{x=300; y=170; width=60; height=60}}
  'highlight'   = @{type='highlight'; props=@{x=300; y=250; width=80; height=30}}
  'cloud'       = @{type='cloud'; props=@{x=420; y=100; width=90; height=60}}
  'polygon'     = @{type='polygon'; props=@{x=420; y=180; width=80; height=60}}
  'textbox'     = @{type='textbox'; props=@{x=420; y=260; width=110; height=40}}
  'polyline'    = @{type='polyline'; props=@{points=@(@{x=560; y=100}, @{x=620; y=130}, @{x=580; y=170})}}
  'spline'      = @{type='spline'; props=@{controlPoints=@(@{x=560; y=200}, @{x=620; y=220}, @{x=580; y=260})}}
  'filledArea'  = @{type='filledArea'; props=@{points=@(@{x=100; y=320}, @{x=200; y=320}, @{x=200; y=390}, @{x=100; y=390}); holes=@(, @(@{x=130; y=340}, @{x=170; y=340}, @{x=170; y=370}, @{x=130; y=370})); fillColor='#cccccc'}}
  'stamp'       = @{type='stamp'; props=@{x=250; y=320; width=50; height=50}}
  'image'       = @{type='image'; props=@{x=320; y=320; width=50; height=50}}
  'comment'     = @{type='comment'; props=@{x=400; y=330}}
  'text'        = @{type='text'; props=@{x=450; y=330; text='T'}}
  'param-stramien' = @{type='parametricSymbol'; props=@{symbolId='stramien'; x=540; y=340; width=60; height=120}}
  'param-staal-hea' = @{type='parametricSymbol'; props=@{symbolId='staal-hea'; params=@{maat='HEA 200'}; x=640; y=340}}
  'param-vloer' = @{type='parametricSymbol'; props=@{symbolId='vloer-kanaalplaatvloer'; params=@{maat='200 standaard'; schaal=0.2}; x=400; y=450}}
  'param-ifc-space' = @{type='parametricSymbol'; props=@{symbolId='ifc-space'; x=600; y=430; width=100; height=80}}
  'param-hout-balk' = @{type='parametricSymbol'; props=@{symbolId='hout-balk'; params=@{maat='45 x 70'}; x=740; y=450}}
  'scaleRegion' = @{type='scaleRegion'; props=@{x=700; y=100; width=110; height=90; scaleString='1:50'}}
}

$results = @()
foreach ($name in $specs.Keys) {
  $spec = $specs[$name]
  $status = 'FAIL'
  $detail = ''
  try {
    # FRESH document per type: this sweep isolates the MOVE contract. With
    # all 22 types stacked on one page the (desired!) corner object snap
    # clicks moving corners onto neighbour points and skews the deltas —
    # snapping has its own test (test-rotate-snap.ps1 T4/T6).
    (Call 'app_new_blank_pdf' @{widthPt=842; heightPt=595}) | Out-Null
    Start-Sleep -Milliseconds 200
    $vp = Call 'app_get_viewport_state' @{}
    $zoom = $vp.viewport.zoom; $ox = $vp.viewport.offsetX; $oy = $vp.viewport.offsetY
    $cl = $vp.canvas.cssLeft; $ct = $vp.canvas.cssTop
    $created = Call 'app_create_annotation' @{type=$spec.type; page=1; props=$spec.props}
    if (-not $created.ok) { $results += [pscustomobject]@{type=$name; status='SKIP'; detail=$created.error}; continue }
    $id = $created.id
    $before = (Call 'app_get_annotation' @{id=$id}).annotation
    $a0 = Get-Anchor $before
    if (-not $a0) { $results += [pscustomobject]@{type=$name; status='SKIP'; detail='geen anker'}; continue }

    (Call 'app_select_annotation' @{id=$id}) | Out-Null
    # Cursor naar p1 VOOR de G — net als een echte gebruiker. De sessie
    # seedt dan altijd op p1 (vers getrackt of via de eerste move).
    $p1 = @{x=520; y=300}; $p2 = @{x=560; y=330}
    (Call 'app_mouse_move' @{x=(ClientX $p1.x); y=(ClientY $p1.y)}) | Out-Null
    (Call 'app_key' @{key='g'}) | Out-Null
    (Call 'app_mouse_move' @{x=(ClientX $p1.x); y=(ClientY $p1.y)}) | Out-Null
    (Call 'app_mouse_move' @{x=(ClientX $p2.x); y=(ClientY $p2.y)}) | Out-Null
    (Call 'app_mouse_click' @{x=(ClientX $p2.x); y=(ClientY $p2.y)}) | Out-Null
    Start-Sleep -Milliseconds 150
    $after = (Call 'app_get_annotation' @{id=$id}).annotation
    $a1 = Get-Anchor $after
    $dx = [math]::Round($a1.x - $a0.x, 1); $dy = [math]::Round($a1.y - $a0.y, 1)
    $expDx = $p2.x - $p1.x; $expDy = $p2.y - $p1.y
    # Object snap may adjust the landing point a few px — tolerance 12.
    if ([math]::Abs($dx - $expDx) -le 12 -and [math]::Abs($dy - $expDy) -le 12 -and ([math]::Abs($dx) + [math]::Abs($dy)) -gt 5) {
      $status = 'PASS'; $detail = "d=($dx,$dy)"
    } else {
      $detail = "verwacht ($expDx,$expDy), kreeg ($dx,$dy)"
    }
    # Move it back out of the way for the next iterations
    (Call 'app_clear_selection' @{}) | Out-Null
  } catch {
    $detail = $_.Exception.Message
  }
  # Drop the per-type document again (keeps the tab strip from growing).
  try {
    $tabs = Call 'app_list_tabs' @{}
    (Call 'app_close_tab' @{index=$tabs.activeIndex; force=$true}) | Out-Null
  } catch { }
  $results += [pscustomobject]@{type=$name; status=$status; detail=$detail}
}

$results | Format-Table -AutoSize
$fail = @($results | Where-Object { $_.status -eq 'FAIL' }).Count
$pass = @($results | Where-Object { $_.status -eq 'PASS' }).Count
"`n$pass PASS, $fail FAIL, $(@($results).Count - $pass - $fail) SKIP"
if ($fail -gt 0) { exit 1 }
