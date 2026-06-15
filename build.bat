@echo off
setlocal enabledelayedexpansion

echo ========================================
echo Building VSIX: NeuralTower-Agent
echo ========================================
echo.

echo [1/3] Compiling TypeScript...
call npm run compile
if %errorlevel% neq 0 (
    echo.
    echo Compilation error. Exiting.
    exit /b 1
)
echo.

echo [2/3] Removing old VSIX packages...
for %%f in (NeuralTower-Agent-*.vsix) do del "%%f"
echo.

echo [3/3] Packaging VSIX...
call npx @vscode/vsce package --allow-missing-repository
if %errorlevel% neq 0 (
    echo.
    echo Packaging error. Exiting.
    exit /b 1
)
echo.

echo ========================================
echo Build completed successfully
echo ========================================
