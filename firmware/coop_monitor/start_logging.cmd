@echo off
title Coop Monitor Logging
pwsh -NoProfile -File "%~dp0run_capture.ps1"
if errorlevel 1 pause
