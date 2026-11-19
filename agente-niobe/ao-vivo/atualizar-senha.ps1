$tok = (Get-Content (Join-Path (Split-Path $PSScriptRoot -Parent) 'projetos\.token') -Raw).Trim()
$cfg = Join-Path $env:APPDATA 'Claude\claude_desktop_config.json'
if (Test-Path $cfg) {
  Copy-Item $cfg ($cfg + '.backup-niobe') -Force
  $t = [IO.File]::ReadAllText($cfg)
  $n = [regex]::Replace($t, '("FILMCRAFT_CONTROL_TOKEN"\s*:\s*")[^"]*(")', ('${1}' + $tok + '${2}'))
  [IO.File]::WriteAllText($cfg, $n, (New-Object Text.UTF8Encoding($false)))
  if ($n -ne $t) { Write-Host 'Senha nova gravada na configuracao do app Claude.' } else { Write-Host 'Nao achei a senha do FilmCraft na configuracao do Claude (nada mudou).' }
} else { Write-Host "Configuracao do Claude nao encontrada em $cfg" }
