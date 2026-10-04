@echo off
rem Warqa for Windows: double-click this file to start the Warqa studio in your browser.
rem   1. Docker Desktop running -> docker compose up -d studio, then open the browser.
rem   2. Node.js 22 or newer    -> pnpm install, pnpm build, pnpm studio, then open the browser.
rem   3. Neither                -> explain what to install and open help.html (en/ar/fr).
rem Options: --check (dry run: print what would happen, change nothing), --docker, --node, --help.
rem This file is plain ASCII with CRLF line endings on purpose (cmd.exe needs both to be reliable).

setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul 2>&1

rem SHIFT also shifts %%0, so remember where this file is before reading the options.
set "SELF=%~f0"
set "HERE=%~dp0"

set "PORT=5170"
set "URL=http://127.0.0.1:%PORT%/"
rem Zero-install web app on GitHub Pages.
set "WEB_URL=https://redouane-e.github.io/warqa/"
set "DOCKER_URL=https://www.docker.com/products/docker-desktop/"
set "NODE_URL=https://nodejs.org/en/download"
set "NODE_MIN=22"

rem Background helper: wait until the studio answers, then open the browser (started by :run_node).
if /i "%~1"=="__open-when-ready" goto :open_when_ready

set "CHECK="
set "FORCE="
:parse_args
if "%~1"=="" goto :args_done
if /i "%~1"=="--check" set "CHECK=1"
if /i "%~1"=="--docker" set "FORCE=docker"
if /i "%~1"=="--node" set "FORCE=node"
if /i "%~1"=="--help" goto :usage
if /i "%~1"=="-h" goto :usage
if "%~1"=="/?" goto :usage
shift
goto :parse_args
:args_done

rem Messages in French when Windows is in French, otherwise in English. The console cannot show
rem Arabic correctly, so Arabic speakers get help.html in the browser when something is missing.
set "UILANG=en"
set "LOCALE="
for /f "tokens=3" %%a in ('reg query "HKCU\Control Panel\International" /v LocaleName 2^>nul ^| find /i "LocaleName"') do set "LOCALE=%%a"
if defined LOCALE if /i "%LOCALE:~0,2%"=="fr" set "UILANG=fr"

rem Go to the Warqa folder (the parent of this "launchers" folder), even if its path has spaces.
cd /d "%HERE%.." 2>nul || goto :fail_root
if not exist "package.json" goto :fail_root
if not exist "docker-compose.yml" goto :fail_root

rem What is available?
set "HAVE_DOCKER="
set "DOCKER_RUNNING="
set "COMPOSE="
where docker >nul 2>&1 && set "HAVE_DOCKER=1"
if defined HAVE_DOCKER (
  docker info >nul 2>&1 && set "DOCKER_RUNNING=1"
  docker compose version >nul 2>&1 && set "COMPOSE=docker compose"
)
if defined HAVE_DOCKER if not defined COMPOSE (
  where docker-compose >nul 2>&1 && set "COMPOSE=docker-compose"
)
set "NODE_OK="
where node >nul 2>&1 && node -e "process.exit(Number(process.versions.node.split('.')[0]) >= %NODE_MIN% ? 0 : 1)" >nul 2>&1 && set "NODE_OK=1"

rem Single-line IFs: a ")" in the folder path would end a parenthesised block early.
if defined CHECK echo [check] repository: %CD%
if defined CHECK echo [check] language: %UILANG%, studio: %URL%, web app: %WEB_URL%
if defined CHECK if defined DOCKER_RUNNING echo [check] docker: running
if defined CHECK if not defined DOCKER_RUNNING if defined HAVE_DOCKER echo [check] docker: installed, not running
if defined CHECK if not defined HAVE_DOCKER echo [check] docker: not found
if defined CHECK if defined NODE_OK echo [check] node: %NODE_MIN% or newer found
if defined CHECK if not defined NODE_OK echo [check] node: missing or older than %NODE_MIN%

rem Already running? Just open it.
call :studio_up && (
  call :say "Warqa is already running." "Warqa est deja lance."
  call :open_url "%URL%"
  goto :end
)

if /i "%FORCE%"=="docker" (
  if not defined DOCKER_RUNNING goto :fail_docker_stopped
  goto :run_docker
)
if /i "%FORCE%"=="node" (
  if not defined NODE_OK goto :fail_node_missing
  goto :run_node
)
if defined DOCKER_RUNNING goto :run_docker
if defined NODE_OK goto :run_node
if defined HAVE_DOCKER goto :fail_docker_stopped
goto :explain


rem ---------------------------------------------------------------------------------------------
:run_docker
if not defined COMPOSE (
  call :say "Docker is installed but 'docker compose' is missing. Update Docker Desktop, then try again." "Docker est installe mais 'docker compose' manque. Mettez Docker Desktop a jour, puis reessayez."
  goto :fail
)
echo.
call :say "-- Starting Warqa with Docker..." "-- Demarrage de Warqa avec Docker..."
call :say "The first start prepares Warqa: it can take 10 to 20 minutes and needs about 4 GB of disk space." "Le premier demarrage prepare Warqa : comptez 10 a 20 minutes et environ 4 Go d'espace disque."
if not exist "books" call :run mkdir books
call :run %COMPOSE% up -d studio || (
  call :say "Docker could not start Warqa. Read the messages above, or run: docker compose logs studio" "Docker n'a pas pu demarrer Warqa. Lisez les messages ci-dessus, ou lancez : docker compose logs studio"
  goto :fail
)
if not defined CHECK (
  call :say "-- Waiting for the studio..." "-- Attente du studio..."
  call :wait_up 180 || (
    call :say "The studio did not answer. See: docker compose logs studio" "Le studio ne repond pas. Voir : docker compose logs studio"
    goto :fail
  )
)
call :open_url "%URL%"
echo.
call :say "Warqa is running at %URL% - you can close this window." "Warqa fonctionne a l'adresse %URL% - vous pouvez fermer cette fenetre."
call :say "Your books are in the 'books' folder of Warqa." "Vos livres sont dans le dossier 'books' de Warqa."
call :say "To stop Warqa: stop 'warqa' in Docker Desktop, or run: docker compose stop studio" "Pour arreter Warqa : arretez 'warqa' dans Docker Desktop, ou lancez : docker compose stop studio"
goto :end


rem ---------------------------------------------------------------------------------------------
:run_node
rem pnpm: use pnpm if installed, otherwise Corepack (bundled with Node.js 22), otherwise npx.
set "COREPACK_ENABLE_DOWNLOAD_PROMPT=0"
set "PM=pnpm@latest"
node -p "require('./package.json').packageManager || 'pnpm@latest'" > "%TEMP%\warqa-pm.txt" 2>nul
if exist "%TEMP%\warqa-pm.txt" set /p PM=<"%TEMP%\warqa-pm.txt"
del "%TEMP%\warqa-pm.txt" >nul 2>&1
set "PNPM="
where pnpm >nul 2>&1 && set "PNPM=pnpm"
if not defined PNPM (
  where corepack >nul 2>&1 && set "PNPM=corepack pnpm"
)
if "%PNPM%"=="corepack pnpm" if not defined CHECK (
  call corepack enable pnpm >nul 2>&1
  where pnpm >nul 2>&1 && set "PNPM=pnpm"
)
if not defined PNPM set "PNPM=npx --yes %PM%"

echo.
call :say "-- Starting Warqa with Node.js..." "-- Demarrage de Warqa avec Node.js..."
call :say "The first start downloads and builds Warqa: it can take 5 to 10 minutes." "Le premier demarrage telecharge et construit Warqa : comptez 5 a 10 minutes."
if not exist "books" call :run mkdir books

call :say "-- Installing: pnpm install" "-- Installation : pnpm install"
call :run %PNPM% install || (
  call :say "The installation failed. Check your internet connection and read the messages above." "L'installation a echoue. Verifiez votre connexion Internet et lisez les messages ci-dessus."
  goto :fail
)
call :say "-- Building: pnpm build" "-- Construction : pnpm build"
call :run %PNPM% build || (
  call :say "The build failed. Read the messages above, or ask for help with the 'Bug report' form." "La construction a echoue. Lisez les messages ci-dessus, ou demandez de l'aide avec le formulaire 'Bug report'."
  goto :fail
)
call :say "-- Starting the studio..." "-- Demarrage du studio..."
if defined CHECK (
  call :run %PNPM% studio
  call :open_url "%URL%"
  goto :end
)
rem The browser opens from a background helper once the studio answers; the studio runs in this window.
start "" /b cmd /c call "%SELF%" __open-when-ready
call :say "Warqa will open in your browser at %URL%" "Warqa va s'ouvrir dans votre navigateur a l'adresse %URL%"
call :say "Keep this window open while you use Warqa. To stop it, close this window or press Ctrl+C." "Gardez cette fenetre ouverte pendant que vous utilisez Warqa. Pour l'arreter, fermez-la ou appuyez sur Ctrl+C."
call %PNPM% studio
if errorlevel 1 (
  call :say "The studio stopped with an error. If the port is busy, Warqa may already be running: open %URL%" "Le studio s'est arrete avec une erreur. Si le port est occupe, Warqa tourne peut-etre deja : ouvrez %URL%"
  goto :fail
)
goto :end


rem ---------------------------------------------------------------------------------------------
:explain
echo.
echo Warqa needs Docker Desktop or Node.js %NODE_MIN% (or newer) on this computer. Neither was found.
echo   - Use Warqa now, without installing anything (web app): %WEB_URL%
echo   - Or install Docker Desktop (simplest): %DOCKER_URL%
echo   - Or install Node.js %NODE_MIN% LTS: %NODE_URL%
echo Then double-click this file again.
echo.
echo Warqa a besoin de Docker Desktop ou de Node.js %NODE_MIN% (ou plus recent). Aucun des deux n'a ete trouve.
echo   - Utilisez Warqa tout de suite, sans rien installer (application web) : %WEB_URL%
echo   - Ou installez Docker Desktop (le plus simple) : %DOCKER_URL%
echo   - Ou installez Node.js %NODE_MIN% LTS : %NODE_URL%
echo Puis double-cliquez a nouveau sur ce fichier.
echo.
echo Arabic: the same explanation is in the page that opens in your browser.
if exist "%HERE%help.html" call :open_url "%HERE%help.html"
goto :fail


rem ---------------------------------------------------------------------------------------------
:fail_root
echo.
call :say "This launcher must stay in the 'launchers' folder of Warqa (next to package.json). Download the whole Warqa folder again." "Ce lanceur doit rester dans le dossier 'launchers' de Warqa. Telechargez a nouveau tout le dossier Warqa."
goto :fail

:fail_docker_stopped
echo.
call :say "Docker is installed but not running. Start Docker Desktop, wait until it is ready, then try again." "Docker est installe mais arrete. Demarrez Docker Desktop, attendez qu'il soit pret, puis reessayez."
goto :fail

:fail_node_missing
echo.
call :say "Node.js %NODE_MIN% or newer is needed: %NODE_URL%" "Node.js %NODE_MIN% ou plus recent est necessaire : %NODE_URL%"
goto :fail

:fail
if not defined CHECK (
  echo.
  pause
)
endlocal
exit /b 1

:end
if not defined CHECK (
  echo.
  pause
)
endlocal
exit /b 0

:usage
echo Usage: Warqa-windows.bat [--check] [--docker ^| --node]
echo   --check   print what would happen, change nothing
echo   --docker  use Docker even if Node.js is available
echo   --node    use Node.js even if Docker is running
endlocal
exit /b 0


rem ---------------------------------------------------------------------------------------------
rem Subroutines
rem ---------------------------------------------------------------------------------------------

rem :say "English" "Francais" - prints the line in the user's language.
rem Messages must not contain & | < > ^ %% or parentheses.
:say
if /i "%UILANG%"=="fr" goto :say_fr
echo(%~1
exit /b 0
:say_fr
echo(%~2
exit /b 0

rem :run command args - runs it, or only prints it with --check
:run
if defined CHECK (
  echo [check] would run: %*
  exit /b 0
)
call %*
exit /b %errorlevel%

rem :open_url "address or file" (single-line IFs: the path may contain parentheses)
:open_url
if defined CHECK echo [check] would open: %~1
if defined CHECK exit /b 0
start "" "%~1"
exit /b 0

rem :studio_up - errorlevel 0 if the studio answers (curl.exe ships with Windows 10 1803 and later)
:studio_up
where curl.exe >nul 2>&1 || goto :studio_up_ps
curl.exe -fsS -o nul --max-time 2 "%URL%" >nul 2>&1
if errorlevel 1 exit /b 1
exit /b 0
:studio_up_ps
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri '%URL%' | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 exit /b 1
exit /b 0

rem :wait_up seconds - errorlevel 0 once the studio answers, 1 after the time limit
:wait_up
set /a "WAITED=0"
:wait_up_loop
call :studio_up && exit /b 0
if %WAITED% geq %~1 exit /b 1
rem ping as a sleep: works even when stdin is not a console (timeout does not)
ping -n 3 127.0.0.1 >nul 2>&1
set /a "WAITED+=2"
goto :wait_up_loop

:open_when_ready
call :wait_up 120 && start "" "%URL%"
exit /b 0
