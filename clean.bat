@echo off
setlocal enabledelayedexpansion

echo ========================================
echo Очистка временных файлов: nt-agent
echo ========================================
echo.

echo [1/5] Очистка директории out/...
if exist "out\" (
    rmdir /s /q "out" >nul 2>&1
    echo   удалено
) else (
    echo   пусто
)

echo [2/5] Очистка пакетов VSIX...
set "found=0"
for %%f in (nt-agent-*.vsix) do (
    del "%%f" >nul 2>&1
    set "found=1"
)
if "!found!"=="1" (
    echo   удалён(ы)
) else (
    echo   пусто
)

echo [3/5] Очистка директории dist/...
if exist "dist\" (
    rmdir /s /q "dist" >nul 2>&1
    echo   удалено
) else (
    echo   пусто
)

echo [4/5] Очистка директории .vscode-test/...
if exist ".vscode-test\" (
    rmdir /s /q ".vscode-test" >nul 2>&1
    echo   удалено
) else (
    echo   пусто
)

echo [5/5] Очистка файлов логов...
del /q *.log >nul 2>&1
del /q npm-debug.log* >nul 2>&1
del /q yarn-debug.log* >nul 2>&1
del /q yarn-error.log* >nul 2>&1
echo   выполнено

echo.
echo ========================================
echo Очистка завершена
echo ========================================
