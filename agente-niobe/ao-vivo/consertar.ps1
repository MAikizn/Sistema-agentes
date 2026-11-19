$raiz = Split-Path $PSScriptRoot -Parent
$tok = (Get-Content (Join-Path $raiz 'projetos\.token') -Raw).Trim()
$cli = @("$env:ProgramFiles\ArtCraft\FilmCraft\filmcraft-cli.exe", "$env:LOCALAPPDATA\Programs\ArtCraft\FilmCraft\filmcraft-cli.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
$o = @("data: $(Get-Date -Format s)", "cli: $cli", "token len: $($tok.Length)")
# 1) configuracao do app Claude: caminho do filmcraft-cli e senha
$cfg = Join-Path $env:APPDATA 'Claude\claude_desktop_config.json'
if (Test-Path $cfg) {
  Copy-Item $cfg ($cfg + '.backup-niobe2') -Force
  $t = [IO.File]::ReadAllText($cfg)
  $antes = [regex]::Match($t, '"filmcraft"\s*:\s*\{[^}]*"command"\s*:\s*"([^"]*)"').Groups[1].Value
  $o += "config claude - command antes: $antes  existe: $(Test-Path ($antes -replace '\\\\','\'))"
  $esc = $cli -replace '\\','\\'
  $n = [regex]::Replace($t, '("filmcraft"\s*:\s*\{[^}]*?"command"\s*:\s*")[^"]*(")', ('${1}' + $esc + '${2}'))
  $n = [regex]::Replace($n, '("FILMCRAFT_CONTROL_TOKEN"\s*:\s*")[^"]*(")', ('${1}' + $tok + '${2}'))
  [IO.File]::WriteAllText($cfg, $n, (New-Object Text.UTF8Encoding($false)))
  $o += "config claude - token igual: $($n -match $tok)  command agora: $([regex]::Match($n, '"filmcraft"\s*:\s*\{[^}]*"command"\s*:\s*"([^"]*)"').Groups[1].Value)"
} else { $o += "config claude nao encontrada: $cfg" }
# 2) FilmCraft e porta
Get-CimInstance Win32_Process -Filter "Name like 'filmcraft%'" | ForEach-Object { $o += "proc $($_.ProcessId) $($_.Name)" }
$c = New-Object Net.Sockets.TcpClient
$o += "porta 9876 aberta: $($c.ConnectAsync('127.0.0.1',9876).Wait(1500))"; $c.Close()
# 3) teste pela ponte com a senha
$env:FILMCRAFT_CONTROL_TOKEN = $tok
$o += "--- teste ponte (inspect project):"
$o += ((& $cli --bridge 127.0.0.1:9876 --compact inspect project 2>&1 | Out-String).Substring(0, [Math]::Min(600, (& $cli --bridge 127.0.0.1:9876 --compact inspect project 2>&1 | Out-String).Length)))
$o | Out-File -Encoding utf8 (Join-Path $PSScriptRoot 'diag2.txt')
# 4) lista completa de comandos (modo sem janela)
& $cli commands --json 2>&1 | Out-File -Encoding utf8 (Join-Path $PSScriptRoot 'comandos.json')
