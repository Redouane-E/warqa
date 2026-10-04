#!/usr/bin/env bash
# Warqa launcher for macOS and Linux, shared by Warqa-mac.command and warqa-linux.sh.
#
#   1. Docker is running      → docker compose up -d studio, then open the studio in the browser.
#   2. Node.js 22 or newer    → pnpm install && pnpm build, then pnpm studio, then open the browser.
#   3. Neither                → explain what to install (English, Arabic, French) and open help.html,
#                               which also links to the web app that needs no installation.
#
# Options:
#   --check    print what would happen and change nothing (no install, no build, no server)
#   --docker   use Docker even if Node.js is available
#   --node     use Node.js even if Docker is running
#   --help     show this help
# Environment: WARQA_LANG=ar|fr|en forces the message language; WARQA_PORT changes the port (Node.js only).
#
# Works with the bash 3.2 that ships with macOS: no associative arrays, no ${var,,}.

set -u

# ---------------------------------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------------------------------
NODE_MIN=22
PORT="${WARQA_PORT:-5170}"                # docker-compose.yml publishes 127.0.0.1:5170
STUDIO_URL="http://127.0.0.1:${PORT}/"
# Zero-install web app on GitHub Pages.
WEB_URL_DEFAULT="https://redouane-e.github.io/warqa/"
DOCKER_DESKTOP_URL="https://www.docker.com/products/docker-desktop/"
NODE_URL="https://nodejs.org/en/download"

CHECK=0
FORCE=""

# ---------------------------------------------------------------------------------------------------
# Paths: this file is launchers/lib/warqa-launch.sh, the repository root is two levels up.
# ---------------------------------------------------------------------------------------------------
LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$LIB_DIR/../.." && pwd)"
HELP_PAGE="$ROOT/launchers/help.html"
OS="$(uname -s 2>/dev/null || echo unknown)"

# ---------------------------------------------------------------------------------------------------
# Messages in the user's language
# ---------------------------------------------------------------------------------------------------
detect_lang() {
  local l="${WARQA_LANG:-}"
  if [ -z "$l" ] && [ "$OS" = "Darwin" ]; then
    # The macOS interface language, e.g. ( "fr-FR", "en-US" ) → fr-FR
    l="$(defaults read -g AppleLanguages 2>/dev/null | sed -n '2s/[^A-Za-z-]//gp')"
  fi
  [ -z "$l" ] && l="${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}"
  case "$l" in
    ar*) echo ar ;;
    fr*) echo fr ;;
    *) echo en ;;
  esac
}
UI_LANG="$(detect_lang)"

# msg "English" "Français" "العربية" → the line in the user's language
msg() {
  case "$UI_LANG" in
    fr) printf '%s\n' "$2" ;;
    ar) printf '%s\n' "$3" ;;
    *) printf '%s\n' "$1" ;;
  esac
}

step() { printf '\n==> %s\n' "$(msg "$@")"; }

interactive() { [ -t 0 ] && [ -t 1 ] && [ "$CHECK" = 0 ]; }

pause() {
  if interactive; then
    printf '\n%s ' "$(msg 'Press Enter to close this window.' 'Appuyez sur Entrée pour fermer cette fenêtre.' 'اضغط على Enter لإغلاق هذه النافذة.')"
    read -r _ || true
  fi
}

# die "English" "Français" "العربية"
die() {
  printf '\n' >&2
  msg "$@" >&2
  pause
  exit 1
}

# run cmd args… — runs it, or only prints it with --check
run() {
  if [ "$CHECK" = 1 ]; then
    printf '[check] would run:'
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi
  "$@"
}

usage() {
  sed -n '2,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

# ---------------------------------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------------------------------
have() { command -v "$1" >/dev/null 2>&1; }

web_url() {
  # https://github.com/owner/repo(.git) or git@github.com:owner/repo(.git) → https://owner.github.io/repo/
  local remote owner repo
  remote="$(git -C "$ROOT" config --get remote.origin.url 2>/dev/null || true)"
  case "$remote" in
    *github.com[:/]*)
      remote="${remote#*github.com[:/]}"
      remote="${remote%.git}"
      owner="${remote%%/*}"
      repo="${remote#*/}"
      if [ -n "$owner" ] && [ -n "$repo" ] && [ "$owner" != "$repo" ]; then
        printf 'https://%s.github.io/%s/\n' "$(printf '%s' "$owner" | tr '[:upper:]' '[:lower:]')" "$repo"
        return
      fi
      ;;
  esac
  printf '%s\n' "$WEB_URL_DEFAULT"
}

open_in_browser() {
  local target="$1"
  if [ "$CHECK" = 1 ]; then
    echo "[check] would open: $target"
    return 0
  fi
  if [ "$OS" = "Darwin" ]; then
    open "$target" >/dev/null 2>&1 && return 0
  else
    for opener in xdg-open gio sensible-browser x-www-browser; do
      if have "$opener"; then
        if [ "$opener" = gio ]; then
          gio open "$target" >/dev/null 2>&1 &
        else
          "$opener" "$target" >/dev/null 2>&1 &
        fi
        return 0
      fi
    done
  fi
  msg "Open this address in your browser: $target" \
    "Ouvrez cette adresse dans votre navigateur : $target" \
    "افتح هذا العنوان في متصفحك: $target"
}

# Is the studio answering?
studio_up() {
  if have curl; then
    curl -fsS -o /dev/null --max-time 2 "$STUDIO_URL" >/dev/null 2>&1
  else
    (exec 3<>"/dev/tcp/127.0.0.1/$PORT") >/dev/null 2>&1
  fi
}

# wait_for_studio <seconds> [pid] — returns 0 once the studio answers, 1 on timeout or if pid exits
wait_for_studio() {
  local limit="$1" pid="${2:-}" waited=0
  while [ "$waited" -lt "$limit" ]; do
    studio_up && return 0
    if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then return 1; fi
    sleep 2
    waited=$((waited + 2))
  done
  return 1
}

node_ok() {
  have node && node -e "process.exit(Number(process.versions.node.split('.')[0]) >= ${NODE_MIN} ? 0 : 1)" >/dev/null 2>&1
}

docker_installed() { have docker; }
docker_running() { have docker && docker info >/dev/null 2>&1; }

# Sets the COMPOSE array to "docker compose" (v2) or "docker-compose" (v1). Returns 1 if neither works.
find_compose() {
  if docker compose version >/dev/null 2>&1; then
    COMPOSE=(docker compose)
  elif have docker-compose; then
    COMPOSE=(docker-compose)
  else
    return 1
  fi
}

# Sets the PNPM array: pnpm on PATH, else Corepack (bundled with Node 22–24), else npx.
find_pnpm() {
  local pm
  pm="$(sed -n 's/.*"packageManager"[[:space:]]*:[[:space:]]*"\(pnpm@[^"]*\)".*/\1/p' "$ROOT/package.json" | head -n 1)"
  [ -n "$pm" ] || pm="pnpm@latest"
  export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
  if have pnpm; then
    PNPM=(pnpm)
  elif have corepack; then
    # `corepack enable` adds a global pnpm when Node's folder is writable; `corepack pnpm` works either way.
    if [ "$CHECK" = 0 ]; then corepack enable pnpm >/dev/null 2>&1 || true; fi
    if have pnpm; then PNPM=(pnpm); else PNPM=(corepack pnpm); fi
  else
    PNPM=(npx --yes "$pm")
  fi
}

# ---------------------------------------------------------------------------------------------------
# The three ways
# ---------------------------------------------------------------------------------------------------
start_with_docker() {
  find_compose || die \
    "Docker is installed but 'docker compose' is missing. Update Docker Desktop, then try again." \
    "Docker est installé mais « docker compose » manque. Mettez Docker Desktop à jour, puis réessayez." \
    "‏Docker مثبّت لكن الأمر «docker compose» غير موجود. حدّث Docker Desktop ثم أعد المحاولة."

  step "Starting Warqa with Docker…" "Démarrage de Warqa avec Docker…" "تشغيل «ورقة» عبر Docker…"
  msg "The first start prepares Warqa: it can take 10 to 20 minutes and needs about 4 GB of disk space." \
    "Le premier démarrage prépare Warqa : comptez 10 à 20 minutes et environ 4 Go d'espace disque." \
    "التشغيل الأول يجهّز «ورقة»: قد يستغرق من 10 إلى 20 دقيقة ويحتاج إلى نحو 4 جيغابايت من المساحة."
  mkdir_books
  run "${COMPOSE[@]}" up -d studio || die \
    "Docker could not start Warqa. Look at the messages above, or run: docker compose logs studio" \
    "Docker n'a pas pu démarrer Warqa. Lisez les messages ci-dessus ou lancez : docker compose logs studio" \
    "لم يتمكن Docker من تشغيل «ورقة». اقرأ الرسائل أعلاه أو نفّذ: docker compose logs studio"

  if [ "$CHECK" = 0 ]; then
    step "Waiting for the studio…" "Attente du studio…" "في انتظار الاستوديو…"
    wait_for_studio 180 || die \
      "The studio did not answer at $STUDIO_URL. See: docker compose logs studio" \
      "Le studio ne répond pas à $STUDIO_URL. Voir : docker compose logs studio" \
      "الاستوديو لا يستجيب على $STUDIO_URL. راجع: docker compose logs studio"
  fi
  open_in_browser "$STUDIO_URL"
  printf '\n'
  msg "Warqa is running at $STUDIO_URL — you can close this window." \
    "Warqa fonctionne à l'adresse $STUDIO_URL — vous pouvez fermer cette fenêtre." \
    "«ورقة» يعمل على $STUDIO_URL — يمكنك إغلاق هذه النافذة."
  msg "Your books are in the folder: $ROOT/books" \
    "Vos livres sont dans le dossier : $ROOT/books" \
    "كتبك محفوظة في المجلد: $ROOT/books"
  msg "To stop Warqa: open Docker Desktop and stop 'warqa', or run: docker compose stop studio" \
    "Pour arrêter Warqa : arrêtez « warqa » dans Docker Desktop, ou lancez : docker compose stop studio" \
    "لإيقاف «ورقة»: أوقف «warqa» من Docker Desktop أو نفّذ: docker compose stop studio"
  pause
}

start_with_node() {
  find_pnpm
  step "Starting Warqa with Node.js ($(node --version 2>/dev/null))…" \
    "Démarrage de Warqa avec Node.js ($(node --version 2>/dev/null))…" \
    "تشغيل «ورقة» عبر Node.js ‏($(node --version 2>/dev/null))…"
  msg "The first start downloads and builds Warqa: it can take 5 to 10 minutes." \
    "Le premier démarrage télécharge et construit Warqa : comptez 5 à 10 minutes." \
    "التشغيل الأول ينزّل «ورقة» ويبنيه: قد يستغرق من 5 إلى 10 دقائق."
  mkdir_books

  step "Installing (pnpm install)…" "Installation (pnpm install)…" "التثبيت (pnpm install)…"
  run "${PNPM[@]}" install || die \
    "The installation failed. Check your internet connection and look at the messages above." \
    "L'installation a échoué. Vérifiez votre connexion Internet et lisez les messages ci-dessus." \
    "فشل التثبيت. تحقّق من اتصالك بالإنترنت واقرأ الرسائل أعلاه."

  step "Building (pnpm build)…" "Construction (pnpm build)…" "البناء (pnpm build)…"
  run "${PNPM[@]}" build || die \
    "The build failed. Look at the messages above, or ask for help with the 'Bug report' form." \
    "La construction a échoué. Lisez les messages ci-dessus ou demandez de l'aide (formulaire « Bug report »)." \
    "فشل البناء. اقرأ الرسائل أعلاه أو اطلب المساعدة عبر استمارة «Bug report»."

  step "Starting the studio…" "Démarrage du studio…" "تشغيل الاستوديو…"
  if [ "$CHECK" = 1 ]; then
    if [ "$PORT" = 5170 ]; then
      run "${PNPM[@]}" studio
    else
      run node apps/studio/dist/server/index.js --root books --port "$PORT"
    fi
    open_in_browser "$STUDIO_URL"
    return 0
  fi

  # Open the browser from the background once the studio answers; the studio itself runs in the
  # foreground so Ctrl+C (or closing the window) stops it cleanly.
  (wait_for_studio 120 && open_in_browser "$STUDIO_URL") &
  local opener=$!
  msg "Warqa will open in your browser at $STUDIO_URL" \
    "Warqa va s'ouvrir dans votre navigateur à l'adresse $STUDIO_URL" \
    "سيُفتح «ورقة» في متصفحك على العنوان $STUDIO_URL"
  msg "Keep this window open while you use Warqa. To stop it, press Ctrl+C or close the window." \
    "Gardez cette fenêtre ouverte pendant que vous utilisez Warqa. Pour l'arrêter : Ctrl+C ou fermez la fenêtre." \
    "اترك هذه النافذة مفتوحة أثناء استعمال «ورقة». للإيقاف اضغط Ctrl+C أو أغلق النافذة."
  local status=0
  if [ "$PORT" = 5170 ]; then
    "${PNPM[@]}" studio || status=$?
  else
    node apps/studio/dist/server/index.js --root books --port "$PORT" || status=$?
  fi
  kill "$opener" >/dev/null 2>&1 || true
  # 130 = stopped with Ctrl+C: a normal way to quit.
  if [ "$status" -ne 0 ] && [ "$status" -ne 130 ]; then
    die "The studio stopped with an error (code $status). If the port is busy, Warqa may already be running: open $STUDIO_URL" \
      "Le studio s'est arrêté avec une erreur (code $status). Si le port est occupé, Warqa tourne peut-être déjà : ouvrez $STUDIO_URL" \
      "توقف الاستوديو بسبب خطأ (الرمز $status). إذا كان المنفذ مشغولًا فربما «ورقة» يعمل أصلًا: افتح $STUDIO_URL"
  fi
}

explain_what_to_install() {
  local web
  web="$(web_url)"
  printf '\n'
  cat <<EOF
Warqa needs Docker Desktop or Node.js ${NODE_MIN} (or newer) on this computer. Neither was found.
  • Use Warqa now, without installing anything (web app):  ${web}
  • Or install Docker Desktop (simplest):  ${DOCKER_DESKTOP_URL}
  • Or install Node.js ${NODE_MIN} LTS:  ${NODE_URL}
Then double-click this launcher again.

Warqa a besoin de Docker Desktop ou de Node.js ${NODE_MIN} (ou plus récent). Aucun des deux n'a été trouvé.
  • Utilisez Warqa tout de suite, sans rien installer (application web) :  ${web}
  • Ou installez Docker Desktop (le plus simple) :  ${DOCKER_DESKTOP_URL}
  • Ou installez Node.js ${NODE_MIN} LTS :  ${NODE_URL}
Puis double-cliquez à nouveau sur ce lanceur.

يحتاج «ورقة» إلى Docker Desktop أو Node.js ${NODE_MIN} (أو أحدث) على هذا الحاسوب، ولم نجد أيًّا منهما.
  • استعمل «ورقة» الآن دون تثبيت أي شيء (تطبيق الويب):  ${web}
  • أو ثبّت Docker Desktop (الأسهل):  ${DOCKER_DESKTOP_URL}
  • أو ثبّت Node.js ${NODE_MIN} LTS:  ${NODE_URL}
ثم انقر نقرًا مزدوجًا على هذا الملف من جديد.
EOF
  if [ -f "$HELP_PAGE" ]; then open_in_browser "$HELP_PAGE"; fi
  pause
  exit 1
}

mkdir_books() {
  if [ ! -d "$ROOT/books" ]; then run mkdir -p "$ROOT/books"; fi
}

# ---------------------------------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------------------------------
for arg in "$@"; do
  case "$arg" in
    --check) CHECK=1 ;;
    --docker) FORCE=docker ;;
    --node) FORCE=node ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $arg (try --help)" >&2
      exit 2
      ;;
  esac
done

cd "$ROOT" || die "Cannot open the Warqa folder: $ROOT" "Impossible d'ouvrir le dossier de Warqa : $ROOT" "تعذّر فتح مجلد «ورقة»: $ROOT"
if [ ! -f "$ROOT/package.json" ] || [ ! -f "$ROOT/docker-compose.yml" ]; then
  die "This launcher must stay in the 'launchers' folder of Warqa (next to package.json). Download the whole Warqa folder again." \
    "Ce lanceur doit rester dans le dossier « launchers » de Warqa. Téléchargez à nouveau tout le dossier Warqa." \
    "يجب أن يبقى هذا الملف داخل مجلد «launchers» في «ورقة». نزّل مجلد «ورقة» كاملًا من جديد."
fi

if [ "$CHECK" = 1 ]; then
  echo "[check] repository: $ROOT"
  echo "[check] language: $UI_LANG · studio: $STUDIO_URL · web app: $(web_url)"
  echo "[check] docker: $(docker_installed && { docker_running && echo running || echo 'installed, not running'; } || echo 'not found')"
  echo "[check] node: $(have node && node --version || echo 'not found') (need ${NODE_MIN}+: $(node_ok && echo yes || echo no))"
fi

if studio_up; then
  step "Warqa is already running." "Warqa est déjà lancé." "«ورقة» يعمل بالفعل."
  open_in_browser "$STUDIO_URL"
  exit 0
fi

case "$FORCE" in
  docker)
    docker_running || die "Docker is not running. Start Docker Desktop, then try again." \
      "Docker n'est pas lancé. Démarrez Docker Desktop, puis réessayez." \
      "‏Docker لا يعمل. شغّل Docker Desktop ثم أعد المحاولة."
    start_with_docker
    exit 0
    ;;
  node)
    node_ok || die "Node.js ${NODE_MIN} or newer is needed: ${NODE_URL}" \
      "Node.js ${NODE_MIN} ou plus récent est nécessaire : ${NODE_URL}" \
      "يلزم Node.js ${NODE_MIN} أو أحدث: ${NODE_URL}"
    start_with_node
    exit 0
    ;;
esac

if docker_running; then
  start_with_docker
elif node_ok; then
  start_with_node
elif docker_installed && [ "$OS" = "Darwin" ] && [ -d "/Applications/Docker.app" ]; then
  step "Docker Desktop is installed but not running: starting it…" \
    "Docker Desktop est installé mais arrêté : démarrage…" \
    "‏Docker Desktop مثبّت لكنه متوقف: جارٍ تشغيله…"
  run open -a Docker
  if [ "$CHECK" = 0 ]; then
    waited=0
    until docker_running || [ "$waited" -ge 120 ]; do
      sleep 3
      waited=$((waited + 3))
    done
    docker_running || die "Docker Desktop did not start. Open it yourself, wait until it says 'running', then try again." \
      "Docker Desktop n'a pas démarré. Ouvrez-le vous-même, attendez qu'il soit prêt, puis réessayez." \
      "لم يبدأ Docker Desktop. افتحه بنفسك وانتظر حتى يصبح جاهزًا ثم أعد المحاولة."
  fi
  start_with_docker
elif docker_installed; then
  die "Docker is installed but not running. Start Docker (Docker Desktop, or: sudo systemctl start docker), then try again." \
    "Docker est installé mais arrêté. Démarrez Docker (Docker Desktop, ou : sudo systemctl start docker), puis réessayez." \
    "‏Docker مثبّت لكنه متوقف. شغّله (Docker Desktop أو: sudo systemctl start docker) ثم أعد المحاولة."
else
  explain_what_to_install
fi
