@echo off
setlocal enabledelayedexpansion

echo ========================================
echo Building VSIX: NeuralTower-Agent
echo ========================================
echo.

echo [1/5] Compiling and bundling (tsc + esbuild + WASM assets)...
call npm run compile
if %errorlevel% neq 0 (
    echo.
    echo Compilation error. Exiting.
    exit /b 1
)
echo.

echo [2/5] Verifying build artifacts...
if not exist "out\extension.js" (
    echo Missing out\extension.js. Exiting.
    exit /b 1
)
if not exist "out\ParserWorker.js" (
    echo Missing out\ParserWorker.js. Exiting.
    exit /b 1
)
if not exist "out\webview\chat.js" (
    echo Missing out\webview\chat.js. Exiting.
    exit /b 1
)
if not exist "out\tree-sitter.wasm" (
    echo Missing out\tree-sitter.wasm. Exiting.
    exit /b 1
)
set "wasmCount=0"
for %%f in (out\wasm\*.wasm) do set /a wasmCount+=1
if !wasmCount! neq 31 (
    echo Expected 31 grammars in out\wasm, got !wasmCount!. Exiting.
    exit /b 1
)
echo   out\extension.js, out\ParserWorker.js, out\webview\chat.js, out\tree-sitter.wasm, out\wasm\ (!wasmCount! grammars) - OK
echo.

echo [3/5] Running tests...
call npm test
if %errorlevel% neq 0 (
    echo.
    echo Test failure. Exiting.
    exit /b 1
)
echo.

echo [4/5] Removing old VSIX packages...
for %%f in (NeuralTower-Agent-*.vsix) do del "%%f"
echo.

echo [5/5] Packaging VSIX...
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
