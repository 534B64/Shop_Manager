@echo off
title Shop Manager - Runtime Test
cd /d "%~dp0.."
call "%~dp0env.bat"
echo ============================================
echo  Shop Manager - Runtime Test
echo  Typecheck + tests + live API smoke test
echo ============================================

set FAILED=0

if not exist node_modules (
  echo Dependencies missing - installing first...
  call npm install
)

echo.
echo [1/3] Typecheck ^(tsc --noEmit^)...
call npm run typecheck
if errorlevel 1 ( echo    ^>^> Typecheck FAILED & set FAILED=1 ) else ( echo    ^>^> Typecheck OK )

echo.
echo [2/3] Unit + integration tests ^(vitest^)...
call npm test
if errorlevel 1 ( echo    ^>^> Tests FAILED & set FAILED=1 ) else ( echo    ^>^> Tests OK )

echo.
echo [3/3] Live runtime smoke test ^(boots the API on a throwaway DB^)...
call npx tsx batch/smoke.ts
if errorlevel 1 ( echo    ^>^> Smoke test FAILED & set FAILED=1 ) else ( echo    ^>^> Smoke test OK )

echo.
echo ============================================
if "%FAILED%"=="0" (
  echo  RESULT: ALL RUNTIME CHECKS PASSED
) else (
  echo  RESULT: ONE OR MORE CHECKS FAILED - scroll up
)
echo ============================================
pause
