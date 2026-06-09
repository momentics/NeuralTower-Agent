@echo off
setlocal enabledelayedexpansion

echo ========================================
echo Сборка VSIX: NeuralTower-Agent
echo ========================================
echo.

echo [1/3] Компиляция TypeScript...
call npm run compile
if %errorlevel% neq 0 (
    echo.
    echo Ошибка компиляции. Выход.
    exit /b 1
)
echo.

echo [2/3] Удаление старых пакетов VSIX...
for %%f in (NeuralTower-Agent-*.vsix) do del "%%f"
echo.

echo [3/3] Упаковка VSIX...
call npx @vscode/vsce package --allow-missing-repository
if %errorlevel% neq 0 (
    echo.
    echo Ошибка упаковки. Выход.
    exit /b 1
)
echo.

echo ========================================
echo Сборка завершена успешно
echo ========================================
