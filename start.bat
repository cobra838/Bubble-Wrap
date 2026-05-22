@echo off
setlocal
cd /d "%~dp0"

echo Starting Bubble Wrap on http://127.0.0.1:3000

where py >nul 2>nul
if %errorlevel%==0 (
  py -3 -m http.server 3000 --bind 127.0.0.1
  goto :eof
)

where python >nul 2>nul
if %errorlevel%==0 (
  python -m http.server 3000 --bind 127.0.0.1
  goto :eof
)

echo Python was not found in PATH.
echo Install Python 3 or run Bubble Wrap from a local web server.
exit /b 1
