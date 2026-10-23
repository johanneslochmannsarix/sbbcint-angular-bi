# Per-process redirection for the metrics app spike. Dot-source at the start of every command.
# Nothing here touches user/system env vars, the global .npmrc or nvm.
$env:Path = 'D:\opt\node22;' + $env:Path
$env:npm_config_cache = 'D:\opt\npm-cache'
$env:UV_CACHE_DIR = 'D:\opt\uv-cache'
$env:UV_PYTHON_INSTALL_DIR = 'D:\opt\uv-python'
$env:UV_PYTHON_PREFERENCE = 'only-managed'
$env:UV_PYTHON_BIN_DIR = 'D:\opt\uv-bin'
