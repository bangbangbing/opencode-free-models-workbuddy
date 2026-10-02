@echo off
REM Run the OpenCode free-model bridge in the foreground (Windows).
REM Needs Node ^22.19 || >=24 on PATH. For a persistent daemon see
REM references\persistence.md (Task Scheduler / Startup folder).
setlocal
node "%~dp0bridge.mjs" %*
endlocal
