# Integrated demo app: backend on http://127.0.0.1:8765 (loopback only, 110 executeQueries/min - the app
# alone on the pim identity) and the Angular dev server on http://localhost:4200 (proxy.4200.json -> 8765).
# Ctrl+C stops ng serve; the finally block then stops the backend and its child processes.
#
#   .\run.ps1          real names and real data (DEMO_REAL=1, the default since 2026-10-23, Johannes)
#   .\run.ps1 -Masked  every person appears as a pseudonym P-xxxxxx. Claude sessions ALWAYS start it with
#                      -Masked: real names must not reach a transcript (skill /spike-demo).
#
# Local screen only, never share. For a run-anywhere showcase without any real value use the synthetic
# package (package-src\build.ps1), not this script.
# Needs `az login` as pim (the tokens are fetched by the backend, never by the browser).
param([switch]$Masked)

. "$PSScriptRoot\..\env.ps1"

$busy = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in @(8765, 4200) }
if ($busy) {
    throw "port(s) $(($busy.LocalPort | Sort-Object -Unique) -join ', ') already in use (pid $(($busy.OwningProcess | Sort-Object -Unique) -join ', ')) - stop that first"
}

# DEMO_REAL / DEMO_LIMIT_PER_MIN reach the backend only: set just for Start-Process, then cleared again.
# With -Masked DEMO_REAL is removed explicitly, so a stray value in the calling shell cannot unmask anything.
if ($Masked) { Remove-Item Env:DEMO_REAL -ErrorAction SilentlyContinue } else { $env:DEMO_REAL = '1' }
$env:DEMO_LIMIT_PER_MIN = '110'
try {
    $backend = Start-Process -PassThru -NoNewWindow -FilePath uv -ArgumentList @(
        'run', '--project', "$PSScriptRoot\backend", '--directory', "$PSScriptRoot\backend",
        'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8765')
}
finally {
    Remove-Item Env:DEMO_REAL -ErrorAction SilentlyContinue
    Remove-Item Env:DEMO_LIMIT_PER_MIN -ErrorAction SilentlyContinue
}

try {
    $mode = if ($Masked) { 'masked' } else { 'REAL NAMES' }
    Write-Host "backend pid $($backend.Id) ($mode, 110/min); open http://localhost:4200 once ng serve is up"
    # npm.cmd, not npm: Node 22's npm.ps1 shim re-parses the raw command text in its own scope, where
    # $PSScriptRoot is not this script's folder.
    & npm.cmd --prefix "$PSScriptRoot\app" run start -- --port 4200 --proxy-config proxy.4200.json
}
finally {
    if ($backend -and -not $backend.HasExited) {
        taskkill /PID $backend.Id /T /F | Out-Null
    }
}
