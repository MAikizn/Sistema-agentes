if ((New-Object Net.Sockets.TcpClient).ConnectAsync('127.0.0.1',9876).Wait(800)) { exit 0 } else { exit 1 }
