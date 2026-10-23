# Run a probe or parity script against the demo backend code (core request ac8 #1, D2 2026-10-21).
# `app` becomes importable for that one child process (PYTHONPATH = backend\), so no caller sets PYTHONPATH
# and no script patches sys.path. The backend is not packaged on purpose: that would need a build backend
# (hatchling / uv_build), i.e. a new package. Always masked: DEMO_REAL is removed for the child.
#
#   D:\work\sbbcargoint\tmp\metrics_app_spike\demo\py.ps1 probes\ac8\live_check.py PROD QA
#   D:\work\sbbcargoint\tmp\metrics_app_spike\demo\py.ps1 parity\ac1\parity.py
#
# The script path is relative to this folder (demo\) or absolute; the working directory is backend\.
param(
    [Parameter(Mandatory, Position = 0)][string]$Script,
    [Parameter(ValueFromRemainingArguments)][string[]]$Rest
)

. "$PSScriptRoot\..\env.ps1"

$path = if ([IO.Path]::IsPathRooted($Script)) { $Script } else { Join-Path $PSScriptRoot $Script }
if (-not (Test-Path $path)) { throw "no such script: $path" }

$backend = "$PSScriptRoot\backend"
$oldPath, $oldReal = $env:PYTHONPATH, $env:DEMO_REAL
$env:PYTHONPATH = $backend
Remove-Item Env:DEMO_REAL -ErrorAction SilentlyContinue
try {
    & uv run --project $backend --directory $backend python $path @Rest
    $code = $LASTEXITCODE
}
finally {
    if ($null -eq $oldPath) { Remove-Item Env:PYTHONPATH -ErrorAction SilentlyContinue } else { $env:PYTHONPATH = $oldPath }
    if ($null -ne $oldReal) { $env:DEMO_REAL = $oldReal }
}
exit $code
