@echo off
title Coop Monitor microSD Transfer
pwsh -NoProfile -File "%~dp0sd_transfer.ps1"
if errorlevel 1 pause
