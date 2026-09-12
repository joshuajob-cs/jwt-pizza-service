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
wait
```

Terminal waits until commands are done rather than instantly exiting after running everything. This is necessary because it is running in the background (&)
