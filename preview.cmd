@echo off
setlocal
cd /d "%~dp0"
where javac >nul 2>nul
if errorlevel 1 (
  echo JDK is required. Add java and javac to PATH.
  exit /b 1
)
if not exist ".work\preview" mkdir ".work\preview"
javac -encoding UTF-8 -d .work\preview tools\PreviewServer.java
if errorlevel 1 exit /b 1
set "PREVIEW_PORT=8080"
if not "%~1"=="" set "PREVIEW_PORT=%~1"
java -cp .work\preview PreviewServer %PREVIEW_PORT% .
