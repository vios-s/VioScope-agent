#!/usr/bin/env bash
set -euo pipefail

SERVICE="${VIOSCOPE_WEB_SERVICE:-vioscope-web.service}"
NPM="${NPM:-npm}"
ACTION="${1:-status}"

case "$ACTION" in
  start|stop|restart|status)
    systemctl --user "$ACTION" "$SERVICE"
    ;;
  logs)
    journalctl --user -u "$SERVICE" -f
    ;;
  build)
    "$NPM" run web:build
    ;;
  rebuild)
    "$NPM" run web:build
    systemctl --user restart "$SERVICE"
    systemctl --user status "$SERVICE" --no-pager
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|logs|build|rebuild}" >&2
    exit 2
    ;;
esac
