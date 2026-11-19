$o = @()
$o += "data: $(Get-Date -Format s)"
$o += "--- filmcraft.exe instalados"
foreach ($p in @("$env:ProgramFiles\ArtCraft\FilmCraft", "$env:LOCALAPPDATA\Programs\ArtCraft\FilmCraft", "$env:ProgramFiles\FilmCraft")) { foreach ($f in @('filmcraft.exe','filmcraft-cli.exe')) { $x = Join-Path $p $f; if (Test-Path $x) { $o += "$x  versao=$((Get-Item $x).VersionInfo.ProductVersion)" } } }
$o += "--- processos FilmCraft (linha de comando)"
Get-CimInstance Win32_Process -Filter "Name like 'filmcraft%'" | ForEach-Object { $o += "$($_.ProcessId)  $($_.ExecutablePath)  ARGS: $($_.CommandLine -replace '^\S+\s?','')" }
$o += "--- quem usa a porta 9876"
Get-NetTCPConnection -LocalPort 9876 -ErrorAction SilentlyContinue | ForEach-Object { $o += "$($_.State) pid=$($_.OwningProcess) $((Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).Path)" }
$o += "--- teste de conexao"
$c = New-Object Net.Sockets.TcpClient
$o += "conecta 9876: $($c.ConnectAsync('127.0.0.1',9876).Wait(1500))"
$o += "--- ajuda do filmcraft"
$fc = @("$env:ProgramFiles\ArtCraft\FilmCraft\filmcraft.exe", "$env:LOCALAPPDATA\Programs\ArtCraft\FilmCraft\filmcraft.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
$cli = Join-Path (Split-Path $fc) 'filmcraft-cli.exe'
if (Test-Path $cli) { $o += (& $cli --help 2>&1 | Out-String); $o += (& $cli mcp --help 2>&1 | Out-String) }
$o | Out-File -Encoding utf8 (Join-Path $PSScriptRoot 'diag.txt')
