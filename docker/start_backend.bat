@echo off
setlocal EnableExtensions EnableDelayedExpansion

if "%CELERY_LOG_LEVEL%"=="" set "CELERY_LOG_LEVEL=info"
if "%CELERY_POOL%"=="" set "CELERY_POOL=solo"
if "%CELERY_CONCURRENCY%"=="" set "CELERY_CONCURRENCY=1"
if "%APP_HOST%"=="" set "APP_HOST=0.0.0.0"
if "%APP_PORT%"=="" set "APP_PORT=8000"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$celery = Start-Process -FilePath 'celery' -ArgumentList @('-A','FastAPI.celery_app:celery_app','worker','--loglevel','%CELERY_LOG_LEVEL%','--pool','%CELERY_POOL%','--concurrency','%CELERY_CONCURRENCY%') -PassThru; " ^
  "$uvicorn = Start-Process -FilePath 'uvicorn' -ArgumentList @('FastAPI.main:app','--host','%APP_HOST%','--port','%APP_PORT%') -PassThru; " ^
  "Wait-Process -Id @($celery.Id,$uvicorn.Id) -Any; " ^
  "Stop-Process -Id @($celery.Id,$uvicorn.Id) -Force -ErrorAction SilentlyContinue | Out-Null; " ^
  "if ($uvicorn.HasExited) { exit $uvicorn.ExitCode } else { exit $celery.ExitCode }"

exit /b %errorlevel%
