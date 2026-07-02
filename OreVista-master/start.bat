@echo off
echo ============================================================
echo   OreVista - Stope Shape Optimizer
echo ============================================================
echo.

if not exist "data\Hackathon 2026 - Block Model.csv" (
    copy "..\Hackathon 2026 - Block Model.csv" "data\Hackathon 2026 - Block Model.csv"
)

start "OreVista Backend" cmd /k "cd /d %~dp0backend && uvicorn main:app --port 8000"
timeout /t 3 /nobreak >nul
start "OreVista Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

echo.
echo Backend:   http://localhost:8000
echo Frontend:  http://localhost:5173
echo.
pause
