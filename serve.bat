@echo off
REM Local test server for the photobooth (Windows). Opens http://localhost:8000
cd /d "%~dp0"
where python >nul 2>nul && (start "" http://localhost:8000 & python -m http.server 8000 & goto :eof)
where py >nul 2>nul && (start "" http://localhost:8000 & py -m http.server 8000 & goto :eof)
where npx >nul 2>nul && (start "" http://localhost:8000 & npx --yes serve -l 8000 . & goto :eof)
echo Need Python or Node.js installed to run a local server.
pause
