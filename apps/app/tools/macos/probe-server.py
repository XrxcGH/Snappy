#!/usr/bin/env python3
"""A loopback test server for webkit-probe.swift: it answers every request and writes one line per request to a file.

  python3 -I probe-server.py <port-file> <request-log>

It listens on 127.0.0.1 only, on a port the system picks, writes the port number to <port-file> and then serves until it
is killed. Each line of <request-log> is "METHOD PATH". A request for /hold is answered only after ten seconds, so the
connection stays open long enough for the socket sampler to see it (probe.sh uses that to check that the sampler can list
the sockets of the web view's networking process). Standard library only; it connects to nothing.
"""

import http.server
import sys
import time


class Handler(http.server.BaseHTTPRequestHandler):
    def respond(self):
        with open(sys.argv[2], "a", encoding="utf-8") as log:
            log.write(f"{self.command} {self.path}\n")
        if self.path.startswith("/hold"):
            time.sleep(10)
        body = b"<!doctype html><title>test server</title>test server"
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)
        except OSError:
            pass  # the client went away first (the held request, when the probe exits)

    do_GET = do_POST = do_HEAD = do_PUT = do_OPTIONS = respond

    def log_message(self, *args):
        pass


server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
with open(sys.argv[1], "w", encoding="utf-8") as f:
    f.write(str(server.server_address[1]))
server.serve_forever()
