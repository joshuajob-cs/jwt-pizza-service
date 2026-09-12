# Notes on the scripts

What each line does, in my own words, so I can rebuild these without help.

## dev.sh

```bash
#!/usr/bin/env bash
```

This basically declares the file type to be a 'bash' file. Everything else in the file will be read as a bash command.

```bash
set -euo pipefail
```

Catches errors when something fails and lets me know.

```bash
SERVICE="$(cd "$(dirname "$0")/.." && pwd)"
```

Creates a variable that represents a directory so I do not need to type in the directory every time.

```bash
port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
```

If exec isn't given a command instead of rewriting the process it opens a file. It is using 3 as the file descriptor to open the connection.

```bash
trap 'trap - INT TERM EXIT; echo "Stopping..."; kill 0; wait' INT TERM EXIT
```

Trap runs code when a signal arrives. This Trap is watching for when the code ends (INT TERM EXIT)

```bash
(cd "$SERVICE" && npm start 2>&1 | sed -u 's/^/[back] /') &
```

sed is stream editor. Allows us to add [front] and [back]

```bash
wait
```

Terminal waits until commands are done rather than instantly exiting after running everything. This is necessary because it is running in the background (&)

## generatePizzaData.sh

```bash
  token=$(echo $response | jq -r 'if any(.user.roles[]?; .role == "admin") then .token else empty end' 2>/dev/null)
```

jq is json query. It filters through json.
