"""Bounded read-only companion API. No signing keys, wallets or write RPCs."""
import collections
import concurrent.futures
import http.server
import json
import os
import threading
import time
import urllib.parse
import urllib.request

from producer_votes import accounts_parameter, snapshot

RPC = os.environ.get('PUREEOS_COMMITTED_RPC', 'http://127.0.0.1:8890')
CHAIN = os.environ['PUREEOS_CHAIN_ID']
TTL = 10
CACHE = collections.OrderedDict()
INFLIGHT = {}
LOCK = threading.Lock()
BATCHES = threading.BoundedSemaphore(2)
ALLOWED = {'get_info', 'get_upgrade_state', 'get_raw_abi', 'get_table_rows', 'get_producers'}


def rpc(method, params):
    if method not in ALLOWED:
        raise ValueError('Read-only RPC method required')
    request = urllib.request.Request(RPC + '/v1/chain/' + method, json.dumps(params).encode(),
                                     {'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=8) as response:
        payload = response.read(1024 * 1024 + 1)
    if len(payload) > 1024 * 1024:
        raise ValueError('RPC response exceeds limit')
    return json.loads(payload)


def cached(accounts):
    with LOCK:
        entry = CACHE.get(accounts)
        if entry and time.monotonic() - entry[0] < TTL:
            CACHE.move_to_end(accounts)
            return entry[1]
        future = INFLIGHT.get(accounts)
        leader = future is None
        if leader:
            future = concurrent.futures.Future()
            INFLIGHT[accounts] = future
    if not leader:
        return future.result(timeout=35)
    try:
        if not BATCHES.acquire(blocking=False):
            raise RuntimeError('Vote snapshot service is busy; retry shortly')
        try:
            result = snapshot(rpc, accounts, CHAIN)
        finally:
            BATCHES.release()
        with LOCK:
            CACHE[accounts] = (time.monotonic(), result)
            CACHE.move_to_end(accounts)
            while len(CACHE) > 64:
                CACHE.popitem(last=False)
        future.set_result(result)
        return result
    except Exception as error:
        future.set_exception(error)
        raise
    finally:
        with LOCK:
            INFLIGHT.pop(accounts, None)


class Handler(http.server.BaseHTTPRequestHandler):
    def respond(self, status, value):
        body = json.dumps(value, separators=(',', ':')).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        # HTTPS ingress owns CORS. Duplicate allow-origin headers are rejected
        # by browsers even when both contain the same wildcard.
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        url = urllib.parse.urlsplit(self.path)
        if url.path != '/v2/state/get_producer_votes':
            return self.respond(404, {'error': 'Unknown read-only endpoint'})
        try:
            params = urllib.parse.parse_qs(url.query, strict_parsing=True)
            if set(params) != {'accounts'} or len(params['accounts']) != 1 or len(url.query) > 1000:
                raise ValueError('Only one bounded accounts parameter is accepted')
            names = accounts_parameter(params['accounts'][0])
        except ValueError as error:
            return self.respond(400, {'error': str(error)})
        try:
            self.respond(200, cached(names))
        except Exception:
            self.respond(503, {'error': 'Committed vote snapshot unavailable; retry shortly'})

    def log_message(self, *_):
        pass


if __name__ == '__main__':
    http.server.ThreadingHTTPServer(('127.0.0.1', 9053), Handler).serve_forever()
