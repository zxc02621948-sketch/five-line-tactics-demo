@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or not available in PATH.
  echo Install Node.js LTS from https://nodejs.org/ and try again.
  pause
  exit /b 1
)
if not exist "node_modules\ws\package.json" (
  echo Installing the small WebSocket dependency...
  call npm install
  if errorlevel 1 (
    echo [ERROR] Dependency installation failed.
    pause
    exit /b 1
  )
)
echo Starting Five Line Tactics Alpha Server...
start "" /b powershell.exe -NoProfile -WindowStyle Hidden -Command "$healthUrl='http://localhost:3000/health'; for($attempt=0; $attempt -lt 40; $attempt++){ try { $response=Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop; if($response.StatusCode -eq 200){ Start-Process 'http://localhost:3000/alpha.html'; exit 0 } } catch {}; Start-Sleep -Milliseconds 250 }; exit 1"
node server.js
echo Alpha Server has stopped.
pause
