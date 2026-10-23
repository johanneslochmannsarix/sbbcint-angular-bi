# Dev pair for ONE showcase (PLAN §14.2): its backend instance (same code, own limiter) + ng serve with its
# proxy file. Ctrl+C stops ng serve; the finally block then stops the backend and its child processes.
#
#   .\dev.ps1 -Showcase ac1        backend http://127.0.0.1:8767, app http://localhost:4202/ac1
#   .\dev.ps1 -Showcase ac2        backend 8766, app http://localhost:4201/ac2
#   .\dev.ps1 -Showcase ac8        backend 8768, app http://localhost:4203/ac8
#   .\dev.ps1 -Showcase ac4        backend 8772, app http://localhost:4204/ac4
#   .\dev.ps1 -Showcase ac10       backend 8770, app http://localhost:4205/ac10
#   .\dev.ps1 -Showcase ac6        backend 8771, app http://localhost:4206/ac6
#   .\dev.ps1 -Showcase ac7        backend 8773, app http://localhost:4207/ac7
#   .\dev.ps1 -Showcase ac9        backend 8774, app http://localhost:4208/ac9
#   .\dev.ps1 -Showcase ac13       backend 8775, app http://localhost:4209/ac13
#   -LimitPerMin N                executeQueries budget of this instance (default 55 = two dev sessions in
#                                  parallel; 35 with three; never above 110 - the 120/min/user cap is shared)
#
# Always masked: dev never sets DEMO_REAL (only run.ps1 -Real does). Needs `az login` as pim.
param(
    [Parameter(Mandatory)][ValidateSet('ac1', 'ac2', 'ac8', 'ac4', 'ac10', 'ac6', 'ac7', 'ac9', 'ac13')][string]$Showcase,
    [ValidateRange(1, 110)][int]$LimitPerMin = 55
)

. "$PSScriptRoot\..\env.ps1"

$ports = @{ ac2 = @(8766, 4201); ac1 = @(8767, 4202); ac8 = @(8768, 4203); ac4 = @(8772, 4204); ac10 = @(8770, 4205); ac6 = @(8771, 4206); ac7 = @(8773, 4207); ac9 = @(8774, 4208); ac13 = @(8775, 4209) }
$backendPort, $appPort = $ports[$Showcase]
$busy = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in @($backendPort, $appPort) }
if ($busy) {
    throw "port(s) $(($busy.LocalPort | Sort-Object -Unique) -join ', ') already in use (pid $(($busy.OwningProcess | Sort-Object -Unique) -join ', ')) - stop that first"
}

# The env vars reach the backend only: set just for Start-Process, then cleared again in this shell.
Remove-Item Env:DEMO_REAL -ErrorAction SilentlyContinue
$env:DEMO_LIMIT_PER_MIN = "$LimitPerMin"
try {
    $backend = Start-Process -PassThru -NoNewWindow -FilePath uv -ArgumentList @(
        'run', '--project', "$PSScriptRoot\backend", '--directory', "$PSScriptRoot\backend",
        'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', "$backendPort")
}
finally {
    Remove-Item Env:DEMO_LIMIT_PER_MIN -ErrorAction SilentlyContinue
}

try {
    Write-Host "$Showcase backend pid $($backend.Id) on 127.0.0.1:$backendPort ($LimitPerMin/min, masked); open http://localhost:$appPort/$Showcase once ng serve is up"
    # npm.cmd, not npm: Node 22's npm.ps1 shim re-parses the raw command text in its own scope, where
    # $PSScriptRoot is not this script's folder. The proxy path is relative to the app folder (npm's cwd).
    & npm.cmd --prefix "$PSScriptRoot\app" run start -- --port $appPort --proxy-config "proxy.$appPort.json"
}
finally {
    if ($backend -and -not $backend.HasExited) {
        taskkill /PID $backend.Id /T /F | Out-Null
    }
}
