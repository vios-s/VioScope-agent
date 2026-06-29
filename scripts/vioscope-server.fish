#!/usr/bin/env fish

set -l service vioscope-web.service
if set -q VIOSCOPE_WEB_SERVICE
    set service $VIOSCOPE_WEB_SERVICE
end

set -l npm npm
if set -q NPM
    set npm $NPM
end
set -l action status
if test (count $argv) -gt 0
    set action $argv[1]
end

switch $action
    case start stop restart status
        systemctl --user $action $service
    case logs
        journalctl --user -u $service -f
    case build
        $npm run web:build
    case rebuild
        $npm run web:build
        systemctl --user restart $service
        systemctl --user status $service --no-pager
    case '*'
        echo "Usage: "(status filename)" {start|stop|restart|status|logs|build|rebuild}" >&2
        exit 2
end
