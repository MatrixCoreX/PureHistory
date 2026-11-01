import unittest
from producer_votes import (PROFILE_ABI, REVIEW_ABI, SUPPORTED_WASM, accounts_parameter,
                            breakdown, name_value, snapshot)

OWNER = 'founderbpgpt'
CHAIN = 'b' * 64


class VotesTests(unittest.TestCase):
    def test_exact_large_amount_and_account_identity(self):
        total = '9007199254740993'
        row = breakdown(OWNER, {'total_votes': total}, {'proxy': '', 'is_proxy': False,
                        'producers': [OWNER], 'last_vote_amount': '1234567'}, {'banned': True})
        self.assertEqual(row['other_votes'], '9007199253506426')
        self.assertEqual(int(row['self_votes']) + int(row['other_votes']), int(total))
        self.assertTrue(row['permanently_blacklisted'])

    def test_vote_for_someone_else_is_not_self(self):
        self.assertEqual(breakdown(OWNER, {'total_votes': '42'}, {'proxy': '', 'is_proxy': 0,
                         'producers': ['openaibp4312'], 'last_vote_amount': '7'}, None)['self_votes'], '0')

    def test_invalid_amounts_and_impossible_sum_fail(self):
        for bad in [True, -1, '1.5', '01', '1e3', 2**63]:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                breakdown(OWNER, {'total_votes': bad}, None, None)
        with self.assertRaises(ValueError):
            breakdown(OWNER, {'total_votes': '1'}, {'proxy': '', 'is_proxy': 0,
                      'producers': [OWNER], 'last_vote_amount': '2'}, None)

    def test_bounds_names_and_no_missing_producer_zero(self):
        self.assertEqual(name_value('eosio'), 6138663577826885632)
        self.assertEqual(accounts_parameter(OWNER), (OWNER,))
        for invalid in ['', OWNER + ',' + OWNER, 'bad6', 'name.', ','.join(['a'] * 51)]:
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                accounts_parameter(invalid)
        with self.assertRaises(ValueError):
            breakdown(OWNER, None, None, None)

    def rpc(self, heads, qualified=True, code=None, abi=PROFILE_ABI):
        def read(method, args):
            if method == 'get_info':
                return {'chain_id': CHAIN}
            if method == 'get_upgrade_state':
                return {'head_block_id': next(heads), 'head_block_num': 42}
            if method == 'get_producers':
                return {'vote_schema': 'integer-v2', 'vote_precision': 4}
            if method == 'get_raw_abi':
                return {'code_hash': (code or next(iter(SUPPORTED_WASM))) if qualified else '0' * 64,
                        'abi_hash': abi}
            if method == 'get_table_rows':
                data = {'producersv2': {'total_votes': '100'},
                        'votersv2': {'proxy': '', 'is_proxy': False, 'producers': [OWNER], 'last_vote_amount': '40'},
                        'rotcands': {'banned': False}}[args['table']]
                return {'rows': [{'owner': OWNER, **data}]}
            raise AssertionError(method)
        return read

    def test_committed_head_change_retries_without_mixing_rows(self):
        read = self.rpc(iter(['a' * 64, 'b' * 64, 'c' * 64, 'c' * 64]))
        result = snapshot(read, (OWNER,), CHAIN)
        self.assertEqual(result['head_block_id'], 'c' * 64)
        self.assertEqual(result['rows'][0]['other_votes'], '60')

    def test_changing_head_fails_after_bounded_attempts(self):
        with self.assertRaisesRegex(ValueError, 'bounded'):
            snapshot(self.rpc(iter(str(i) * 64 for i in range(6))), (OWNER,), CHAIN)

    def test_unknown_system_code_and_chain_mismatch(self):
        self.assertFalse(snapshot(self.rpc(iter(['a' * 64]), False), (OWNER,), CHAIN)['available'])
        with self.assertRaisesRegex(ValueError, 'identity'):
            snapshot(self.rpc(iter([])), (OWNER,), 'c' * 64)

    def test_qualified_upgrade_preserves_exact_vote_snapshot(self):
        released = '6ed4cccc3aac05231f95e63b5464325315668bea2997ddb15de0b29768bf3a62'
        candidate = '373b66b2994c3131ce6c9c3d4526fdf836c0ac2c36d8265b2239d61e75ca2ceb'
        a = snapshot(self.rpc(iter(['a' * 64] * 2), code=released), (OWNER,), CHAIN)
        b = snapshot(self.rpc(iter(['a' * 64] * 2), code=candidate), (OWNER,), CHAIN)
        self.assertTrue(b['available'])
        self.assertEqual(a['rows'], b['rows'])

    def test_rejected_candidate_is_unavailable(self):
        rejected = '590c0be3305d78594ba9ce7a244e755de37e04fac45f085d6fec68c4b2470801'
        self.assertFalse(snapshot(self.rpc(iter(['a' * 64]), code=rejected), (OWNER,), CHAIN)['available'])

    def test_reviewed_abi_preserves_votes_and_requires_qualified_code_pair(self):
        candidate = '373b66b2994c3131ce6c9c3d4526fdf836c0ac2c36d8265b2239d61e75ca2ceb'
        result = snapshot(self.rpc(iter(['a' * 64] * 2), code=candidate, abi=REVIEW_ABI), (OWNER,), CHAIN)
        self.assertTrue(result['available'])
        self.assertEqual(result['rows'][0]['other_votes'], '60')
        released = '6ed4cccc3aac05231f95e63b5464325315668bea2997ddb15de0b29768bf3a62'
        self.assertFalse(snapshot(self.rpc(iter(['a' * 64]), code=released, abi=REVIEW_ABI), (OWNER,), CHAIN)['available'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
