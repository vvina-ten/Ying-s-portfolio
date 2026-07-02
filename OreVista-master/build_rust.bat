@echo off
chcp 65001 >nul
echo ============================================
echo  OreVista - Build Rust Core Accelerator
echo ============================================

rustc --version >nul 2>&1
if errorlevel 1 goto no_rust

echo Rust found:
rustc --version
cargo --version

echo Installing maturin...
pip install "maturin>=1.5,<2.0"
if errorlevel 1 goto pip_fail

echo Building rust_core wheel (release, first run takes 60-120s)...
cd /d "%~dp0rust_core"
maturin build --release
if errorlevel 1 goto build_fail

echo Installing wheel...
for /f "delims=" %%f in ('dir /b /s "target\wheels\rust_core-*.whl" 2^>nul') do set WHEEL=%%f
if "%WHEEL%"=="" goto no_wheel
pip install --force-reinstall "%WHEEL%"
if errorlevel 1 goto install_fail
cd /d "%~dp0"

echo ============================================
echo  SUCCESS - rust_core built and installed
echo  Restart the backend to activate it.
echo ============================================
pause
exit /b 0

:no_rust
echo Rust is not installed.
echo Please install from: https://rustup.rs
echo Download and run rustup-init.exe, then re-run this script.
echo If Rust is installed but not on PATH, run:
echo   set PATH=%USERPROFILE%\.cargo\bin;%PATH%
echo Then re-run this script.
pause
exit /b 1

:pip_fail
echo Failed to install maturin. Check that pip is on PATH.
pause
exit /b 1

:build_fail
cd /d "%~dp0"
echo Cargo build failed. Try: rustup update stable
pause
exit /b 1

:no_wheel
cd /d "%~dp0"
echo Could not find built wheel in rust_core/target/wheels/
pause
exit /b 1

:install_fail
cd /d "%~dp0"
echo pip install of wheel failed.
pause
exit /b 1
