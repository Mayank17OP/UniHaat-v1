#!/usr/bin/env python3
"""Start a throwaway PostgreSQL for the UniHaat SQL suites.

The suites expect a server they can reach over TCP on
127.0.0.1:55432. `pgserver` ships a real PostgreSQL in a wheel, which
is what makes the SQL suites runnable without a system install.

    /tmp/pgvenv/bin/python scripts/local-postgres.py

Prints the DATABASE_URL the other scripts expect.
"""

import os
import pathlib
import subprocess
import time

import pgserver

DATA = pathlib.Path(os.environ.get("UH_PGDATA", "/tmp/unihaat-pgdata"))
PORT = int(os.environ.get("UH_PGPORT", "55432"))
DATA.mkdir(parents=True, exist_ok=True)

server = pgserver.get_server(DATA, cleanup_mode=None)

# pgserver keeps the server on a Unix socket, so that two suites never
# fight over a port. The suites expect TCP, so the server is restarted
# with a listener on the loopback address as well.
PG_CTL = pathlib.Path(pgserver.__file__).parent / "pginstall" / "bin" / "pg_ctl"
subprocess.run(
    [
        str(PG_CTL), "-D", str(DATA), "-m", "fast", "-w", "stop",
    ],
    check=False,
    capture_output=True,
)
subprocess.run(
    [
        str(PG_CTL), "-D", str(DATA), "-l", str(DATA / "server.log"), "-w", "start",
        "-o", f"-h 127.0.0.1 -p {PORT} -k {DATA}",
    ],
    check=True,
)

url = f"postgres://postgres@127.0.0.1:{PORT}/postgres"
print("DATA_URL=" + url, flush=True)

# Keep the server up until the process is stopped.
while True:
    time.sleep(3600)
