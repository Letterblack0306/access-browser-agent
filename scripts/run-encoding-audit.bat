@echo off
REM Ensure target output directory exists
if not exist "G:\temp" mkdir "G:\temp"

echo Starting full drive encoding audit on G:...
node "G:\Developments\46_Accecc_Browser_Agent\Browser Agent\scripts\audit-encoding.js" "G:\." > "G:\temp\encoding-audit-G.json" 2>&1

echo.
echo Scan complete. Full report saved to G:\temp\encoding-audit-G.json
pause
