#!/usr/bin/env python3
"""Watches the network sockets of the Snappy app on macOS and reports every connection to a non-loopback address.

Used only by apps/app/tools/macos/smoke.sh in CI (standard library only, no network code of its own beyond the control).
Run it with `python3 -I` so nothing from the environment is imported.

What it watches. On macOS the system web view (WebKit) does its networking in a separate helper process
(com.apple.WebKit.Networking) that is started through launchd, so it is NOT a child of the app. A sampler that walked only
the app's process tree would never see the one process that could connect. So "the app's processes" here are:

  1. every process whose command line contains the text in the environment variable SNAPPY_MATCH (the app's executable
     path), and all their descendants; and
  2. every WebKit helper process (a command line with com.apple.WebKit.) that was not running when the watch started.
     The job starts this before it opens the app, on a runner where nothing else uses WebKit.

How. Every INTERVAL seconds it runs `lsof -nP -i` (all internet sockets of this user) and keeps the rows of those
processes. A socket with a remote address that is not loopback is a connection out. Sockets that are only bound to a
non-loopback address are listed separately. Rows of every other process are summarised as information, which also shows
that the sampler sees connections at all.

Limits, said plainly: it samples, so a connection that opens and closes between two samples is missed; it sees only this
user's processes and only internet sockets (a Unix socket or a raw socket is not listed); it cannot read the contents.

Exit codes: 0 nothing seen (or, with --control, the control connection was seen); 3 the app's processes had a
connection to a non-loopback address; 4 the control connection was NOT seen (the sampler cannot be trusted);
5 the app never appeared while watching.
"""

import argparse
import os
import re
import subprocess
import sys
import time

LOOPBACK = re.compile(r"^(127\.|::1$|::ffff:127\.|localhost$)", re.IGNORECASE)
WEBKIT_HELPER = "com.apple.WebKit."


def process_table():
    """pid -> (ppid, command line), from ps."""
    out = subprocess.run(["ps", "-axo", "pid=,ppid=,command="], capture_output=True, text=True, check=False).stdout
    rows = {}
    for line in out.splitlines():
        m = re.match(r"\s*(\d+)\s+(\d+)\s+(.*)$", line)
        if m:
            rows[int(m.group(1))] = (int(m.group(2)), m.group(3))
    return rows


def with_descendants(rows, roots):
    found = set(roots)
    grew = True
    while grew:
        grew = False
        for pid, (ppid, _) in rows.items():
            if pid not in found and ppid in found:
                found.add(pid)
                grew = True
    return found


def own_chain(rows):
    """This process and its ancestors, so the watch never counts itself or the shell that started it."""
    chain = set()
    pid = os.getpid()
    while pid and pid not in chain:
        chain.add(pid)
        pid = rows.get(pid, (0, ""))[0]
    return chain


def sockets():
    """[(pid, command, protocol, name)] for every internet socket of this user."""
    out = subprocess.run(["lsof", "-nP", "-w", "-i", "-F", "pcfPtn"], capture_output=True, text=True, check=False).stdout
    rows, pid, cmd, cur = [], None, "", None

    def flush():
        if cur is not None and pid is not None and cur.get("n"):
            rows.append((pid, cmd, cur.get("P", "?"), cur["n"]))

    for line in out.splitlines():
        if not line:
            continue
        tag, value = line[0], line[1:]
        if tag == "p":
            flush()
            cur = None
            pid, cmd = int(value), ""
        elif tag == "c":
            cmd = value
        elif tag == "f":
            flush()
            cur = {}
        elif cur is not None:
            cur[tag] = value
    flush()
    return rows


def remote_of(name):
    """The remote host of a socket name such as 10.0.0.5:5000->140.82.112.3:443, or None for a socket with no peer."""
    if "->" not in name:
        return None
    remote = name.split("->", 1)[1]
    host = remote.rsplit(":", 1)[0]
    return host.strip("[]")


def local_host_of(name):
    local = name.split("->", 1)[0]
    return local.rsplit(":", 1)[0].strip("[]")


def watch(find_roots, seconds, interval, stop_file, log, baseline_webkit, include_webkit):
    """Samples until `seconds` have passed (or the stop file appears). Returns a result dictionary."""
    start = time.monotonic()
    ticks, gaps = 0, []
    last = None
    app_seen = False
    first_app_t = None
    attributed = {}  # pid -> (ppid, command), everything that was ever counted as the app's
    out_conn = {}  # (pid, cmd, proto, name) -> [first_t, ticks]
    loop_conn = {}
    bound = {}
    others = {}  # (cmd, proto, remote) -> ticks
    while True:
        now = time.monotonic()
        t = now - start
        if last is not None:
            gaps.append(now - last)
        last = now
        if t >= seconds or (stop_file and os.path.exists(stop_file)):
            break
        rows = process_table()
        mine = own_chain(rows)
        roots = {p for p in find_roots(rows) if p not in mine}
        ours = with_descendants(rows, roots) if roots else set()
        if include_webkit:
            ours |= {p for p, (_, c) in rows.items() if WEBKIT_HELPER in c and p not in baseline_webkit and p not in mine}
        if ours:
            app_seen = True
            if first_app_t is None:
                first_app_t = t
            for p in ours:
                attributed.setdefault(p, rows.get(p, (0, "?")))
        for pid, cmd, proto, name in sockets():
            remote = remote_of(name)
            if pid in ours:
                if remote is None:
                    host = local_host_of(name)
                    if not LOOPBACK.match(host):
                        bound.setdefault((pid, cmd, proto, name), [t, 0])[1] += 1
                elif LOOPBACK.match(remote):
                    loop_conn.setdefault((pid, cmd, proto, name), [t, 0])[1] += 1
                else:
                    out_conn.setdefault((pid, cmd, proto, name), [t, 0])[1] += 1
                    log.write(f"t={t:7.2f}s APP CONNECTION pid={pid} {cmd} {proto} {name}\n")
                    log.flush()
            elif remote is not None and not LOOPBACK.match(remote):
                others[(cmd, proto, remote)] = others.get((cmd, proto, remote), 0) + 1
        ticks += 1
        time.sleep(max(0.0, interval - (time.monotonic() - now)))
    return {
        "ticks": ticks,
        "mean_gap": sum(gaps) / len(gaps) if gaps else 0.0,
        "max_gap": max(gaps) if gaps else 0.0,
        "seconds": time.monotonic() - start,
        "app_seen": app_seen,
        "first_app_t": first_app_t,
        "attributed": attributed,
        "out": out_conn,
        "loop": loop_conn,
        "bound": bound,
        "others": others,
    }


def summarise(log, r, title):
    log.write(f"\n== {title} ==\n")
    log.write(f"samples: {r['ticks']} over {r['seconds']:.1f} s; mean gap {r['mean_gap'] * 1000:.0f} ms, longest gap {r['max_gap'] * 1000:.0f} ms\n")
    if r["first_app_t"] is not None:
        log.write(f"the app first appeared {r['first_app_t']:.1f} s after the watch began\n")
    log.write(f"processes counted as the app's ({len(r['attributed'])}):\n")
    for pid, (ppid, cmd) in sorted(r["attributed"].items()):
        log.write(f"  pid {pid} (parent {ppid}) {cmd[:200]}\n")
    log.write(f"connections to a non-loopback address by those processes: {len(r['out'])}\n")
    for (pid, cmd, proto, name), (t0, n) in sorted(r["out"].items(), key=lambda kv: kv[1][0]):
        log.write(f"  first at {t0:.1f} s, seen in {n} samples: pid {pid} {cmd} {proto} {name}\n")
    log.write(f"loopback-only connections by those processes: {len(r['loop'])}\n")
    for (pid, cmd, proto, name), (t0, n) in sorted(r["loop"].items(), key=lambda kv: kv[1][0]):
        log.write(f"  first at {t0:.1f} s, seen in {n} samples: pid {pid} {cmd} {proto} {name}\n")
    log.write(f"sockets those processes only bound to a non-loopback address (no peer): {len(r['bound'])}\n")
    for (pid, cmd, proto, name), (t0, n) in sorted(r["bound"].items(), key=lambda kv: kv[1][0]):
        log.write(f"  first at {t0:.1f} s, seen in {n} samples: pid {pid} {cmd} {proto} {name}\n")
    log.write(f"information: connections out by ALL OTHER processes of this user ({len(r['others'])} distinct; the runner's own tools are among them):\n")
    for (cmd, proto, remote), n in sorted(r["others"].items(), key=lambda kv: -kv[1])[:40]:
        log.write(f"  {cmd} {proto} -> {remote} (seen in {n} samples)\n")
    log.flush()


def control(log, interval):
    """Positive control: a child opens a real outside connection and holds it. The same watch must see it."""
    code = (
        "import socket,time,sys\n"
        "for host in ('github.com','1.1.1.1'):\n"
        "    try:\n"
        "        s=socket.create_connection((host,443),timeout=10)\n"
        "        break\n"
        "    except OSError:\n"
        "        s=None\n"
        "if s is None: sys.exit(9)\n"
        "time.sleep(8)\n"
    )
    child = subprocess.Popen([sys.executable, "-I", "-c", code])
    try:
        r = watch(lambda rows: {child.pid}, 7.0, interval, None, log, set(), False)
    finally:
        child.terminate()
        child.wait(timeout=15)
    summarise(log, r, "positive control (a child process that holds a connection to github.com:443)")
    seen = len(r["out"]) > 0
    log.write(f"control result: {'the sampler SAW the control connection' if seen else 'the sampler did NOT see the control connection'}\n")
    return 0 if seen else 4


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--log", required=True)
    ap.add_argument("--interval", type=float, default=0.5)
    ap.add_argument("--max-seconds", type=float, default=300.0)
    ap.add_argument("--stop-file")
    ap.add_argument("--control", action="store_true")
    args = ap.parse_args()
    with open(args.log, "a", encoding="utf-8") as log:
        if args.control:
            return control(log, args.interval)
        match = os.environ.get("SNAPPY_MATCH", "")
        if not match:
            log.write("SNAPPY_MATCH is not set.\n")
            return 2
        baseline = {p for p, (_, c) in process_table().items() if WEBKIT_HELPER in c}
        log.write(f"watch started; WebKit helpers already running before the app: {sorted(baseline)}\n")
        log.write(f"the app's processes are those whose command line contains: {match}\n")
        log.flush()
        r = watch(lambda rows: {p for p, (_, c) in rows.items() if match in c}, args.max_seconds, args.interval, args.stop_file, log, baseline, True)
        summarise(log, r, "the app")
        if not r["app_seen"]:
            log.write("RESULT: the app never appeared while watching.\n")
            return 5
        if r["out"]:
            log.write("RESULT: FAIL, the app's processes had a connection to a non-loopback address (listed above).\n")
            return 3
        log.write("RESULT: no connection to a non-loopback address was seen from the app's processes.\n")
        return 0


if __name__ == "__main__":
    sys.exit(main())
