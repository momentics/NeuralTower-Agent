@echo off
setlocal enabledelayedexpansion

echo ========================================
echo Cleaning build artifacts: NeuralTower-Agent
echo ========================================
echo.

echo [1/4] Cleaning out/ directory (bundles + WASM assets)...
if exist "out\" (
    rmdir /s /q "out" >nul 2>&1
    echo   deleted
) else (
    echo   empty
)

echo [2/4] Cleaning VSIX packages...
set "found=0"
for %%f in (NeuralTower-Agent-*.vsix) do (
    del "%%f" >nul 2>&1
    set "found=1"
)
if "!found!"=="1" (
    echo   deleted
) else (
    echo   empty
)

echo [3/4] Cleaning .vscode-test/ directory...
if exist ".vscode-test\" (
    rmdir /s /q ".vscode-test" >nul 2>&1
    echo   deleted
) else (
    echo   empty
)

echo [4/4] Cleaning log files...
del /q *.log >nul 2>&1
del /q npm-debug.log* >nul 2>&1
del /q yarn-debug.log* >nul 2>&1
del /q yarn-error.log* >nul 2>&1
echo   done

echo.
echo ========================================
echo Cleanup complete
echo ========================================
