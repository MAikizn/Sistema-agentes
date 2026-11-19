@echo off
set FILMCRAFT_CONTROL_TOKEN=b2c8a8e0407e930350686da066ba38a0a2b0fc8b21e4363149c4821b7a781ea5
start "" "%ProgramFiles%\ArtCraft\FilmCraft\filmcraft.exe" --control 9876 "%~dp0projetos\GM_midea.fcproj"
