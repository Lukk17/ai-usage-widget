import http.server
import json
import pathlib
import ssl
import sys
import threading
import urllib.parse

FIXTURE_ROOT = pathlib.Path(__file__).resolve().parent.parent / "fixtures"
SCENARIOS = json.loads((FIXTURE_ROOT / "scenarios.json").read_text(encoding="utf-8"))["scenarios"]
SERVICE_ADDRESS = "127.0.0.10"
RECORDER_ADDRESS = "127.0.0.20"
HTTPS_PORT = 443
RECORDER_READOUT_PORT = 8766
REDIRECT_TARGET = "https://redirect-target.test/landing"
HUGE_BODY_BYTES = 5 * 1024 * 1024
KEY_PREFIX = "scenario-"
RECORDED_HEADERS = []


def recorded_reply(name):
    target = (FIXTURE_ROOT / (name + ".json")).resolve()
    if FIXTURE_ROOT not in target.parents or not target.is_file():
        return None
    return json.loads(target.read_text(encoding="utf-8"))


def scenario_for(headers):
    authorization = headers.get("Authorization", "")
    key = authorization[len("Bearer "):] if authorization.startswith("Bearer ") else headers.get("x-api-key", "")
    if not key.startswith(KEY_PREFIX):
        return None
    return SCENARIOS.get(key[len(KEY_PREFIX):])


class QuietHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        return

    def send_body(self, status, headers, body, with_length=True):
        payload = body.encode("utf-8")
        self.send_response(status)
        for name, value in headers.items():
            self.send_header(name, value)
        if with_length:
            self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        try:
            self.wfile.write(payload)
        except (BrokenPipeError, ConnectionResetError):
            return


class ServiceHandler(QuietHandler):
    def do_GET(self):
        scenario = scenario_for(self.headers)
        if scenario is None:
            self.send_body(401, {"Content-Type": "application/json"}, '{"error":"unknown key"}')
            return
        path = urllib.parse.urlsplit(self.path).path
        name = scenario.get(path, scenario.get("*"))
        if name == "special/redirect":
            self.send_body(302, {"Location": REDIRECT_TARGET}, "")
            return
        if name == "special/huge":
            self.send_body(200, {"Content-Type": "application/json"}, "x" * HUGE_BODY_BYTES, with_length=False)
            return
        recorded = recorded_reply(name) if name else None
        if recorded is None:
            self.send_body(404, {"Content-Type": "text/plain"}, "no such fixture")
            return
        body = recorded["bodyText"] if "bodyText" in recorded else json.dumps(recorded["body"])
        self.send_body(recorded["status"], recorded.get("headers", {}), body)


class RecorderHandler(QuietHandler):
    def do_GET(self):
        RECORDED_HEADERS.append({name.lower(): value for name, value in self.headers.items()})
        self.send_body(200, {"Content-Type": "application/json"}, "{}")


class ReadoutHandler(QuietHandler):
    def do_GET(self):
        self.send_body(200, {"Content-Type": "application/json"}, json.dumps(RECORDED_HEADERS))


def https_server(address, handler, certificate, key):
    server = http.server.ThreadingHTTPServer((address, HTTPS_PORT), handler)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(certificate, key)
    server.socket = context.wrap_socket(server.socket, server_side=True)
    return server


def main():
    certificate, key = sys.argv[1], sys.argv[2]
    servers = [
        https_server(SERVICE_ADDRESS, ServiceHandler, certificate, key),
        https_server(RECORDER_ADDRESS, RecorderHandler, certificate, key),
        http.server.ThreadingHTTPServer((RECORDER_ADDRESS, RECORDER_READOUT_PORT), ReadoutHandler),
    ]
    for server in servers[1:]:
        threading.Thread(target=server.serve_forever, daemon=True).start()
    servers[0].serve_forever()


if __name__ == "__main__":
    main()
