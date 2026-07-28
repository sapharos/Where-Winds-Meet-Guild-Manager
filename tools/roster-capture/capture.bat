@echo off
REM Runs the capture tool from its own folder, so it works from any shell and
REM by double-clicking. Arguments are passed through: capture.bat --calibrate
cd /d "%~dp0"
python capture.py %*
echo.
pause
