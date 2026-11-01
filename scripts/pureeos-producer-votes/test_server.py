import http.server
import json
import os
import threading
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch

os.environ.setdefault('PUREEOS_CHAIN_ID', 'a' * 64)
from server import Handler


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = 'http://127.0.0.1:' + str(self.server.server_port)

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def test_ingress_owns_cors_no_duplicate_wildcard(self):
        with patch('server.cached', return_value={'available': True, 'rows': []}) as read:
            with urllib.request.urlopen(self.url + '/v2/state/get_producer_votes?accounts=founderbpgpt') as response:
                self.assertEqual(response.status, 200)
                self.assertIsNone(response.headers.get_all('Access-Control-Allow-Origin'))
                self.assertEqual(json.load(response)['available'], True)
            read.assert_called_once_with(('founderbpgpt',))

    def test_invalid_queries_and_write_requests_never_reach_rpc(self):
        with patch('server.cached') as read:
            for suffix in ['?accounts=a&accounts=b', '?accounts=a,a', '?accounts=a&url=http://example.com', '?accounts=bad6']:
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(self.url + '/v2/state/get_producer_votes' + suffix)
                self.assertEqual(error.exception.code, 400)
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(urllib.request.Request(self.url + '/v1/chain/push_transaction', b'{}'))
            self.assertEqual(error.exception.code, 501)
            read.assert_not_called()


if __name__ == '__main__':
    unittest.main(verbosity=2)
