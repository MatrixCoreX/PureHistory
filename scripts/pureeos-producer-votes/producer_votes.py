"""Exact direct-vote breakdown, read from a nonproducing committed-state node."""
import concurrent.futures
import datetime
import re

# Native get_raw_abi hashes packed ABI bytes, not the human-readable .abi JSON.
PROFILE_ABI = '3ede155adf72526771d86bbfa789922c8e1394ab7b51ba61e00e189f7bb4efba'
SUPPORTED_WASM = {'6ed4cccc3aac05231f95e63b5464325315668bea2997ddb15de0b29768bf3a62',
                  '373b66b2994c3131ce6c9c3d4526fdf836c0ac2c36d8265b2239d61e75ca2ceb'}
REVIEW_ABI = '038ffbab99e3c261dfc0d1655ddd3acd75b89bfeaae350eb86e4df930564f959'
SUPPORTED_PROFILES = {(code, PROFILE_ABI) for code in SUPPORTED_WASM} | {
    ('373b66b2994c3131ce6c9c3d4526fdf836c0ac2c36d8265b2239d61e75ca2ceb', REVIEW_ABI)}
NAME = re.compile(r'[a-z1-5.]{1,12}')
READERS = concurrent.futures.ThreadPoolExecutor(max_workers=8)


def accounts_parameter(value):
    names = value.split(',') if isinstance(value, str) else []
    if not 1 <= len(names) <= 50 or len(set(names)) != len(names):
        raise ValueError('Request requires 1 to 50 unique producer accounts')
    if any(not NAME.fullmatch(n) or n.endswith('.') for n in names):
        raise ValueError('Invalid producer account')
    return tuple(sorted(names))


def name_value(name):
    alphabet = '.12345abcdefghijklmnopqrstuvwxyz'
    value = 0
    for i in range(12):
        value |= (alphabet.index(name[i]) if i < len(name) else 0) << (64 - 5 * (i + 1))
    return value


def integer(value):
    if isinstance(value, bool) or not re.fullmatch(r'0|[1-9][0-9]*', str(value)):
        raise ValueError('Invalid integer vote amount')
    amount = int(value)
    if amount > (1 << 63) - 1:
        raise ValueError('Vote amount exceeds the qualified int64 schema')
    return amount


def point(rpc, table, owner):
    result = rpc('get_table_rows', {'json': True, 'code': 'eosio', 'scope': 'eosio',
                                  'table': table, 'lower_bound': str(name_value(owner)),
                                  'key_type': 'i64', 'index_position': '1', 'limit': 1})
    rows = result.get('rows')
    if not isinstance(rows, list) or len(rows) > 1:
        raise ValueError('Invalid point lookup response')
    return rows[0] if rows and rows[0].get('owner') == owner else None


def breakdown(owner, producer, voter, candidate):
    if producer is None:
        raise ValueError('Producer record is unavailable: ' + owner)
    total = integer(producer['total_votes'])
    own = 0
    if voter is not None:
        selected = voter.get('producers')
        if voter.get('proxy') not in ('', None) or voter.get('is_proxy') not in (False, 0):
            raise ValueError('Unsupported proxy vote record')
        if not isinstance(selected, list) or len(selected) > 1:
            raise ValueError('Unsupported single-choice vote record')
        allocated = integer(voter['last_vote_amount'])
        if selected == [owner]:
            own = allocated
    if own > total:
        raise ValueError('Self votes exceed total votes')
    banned = candidate.get('banned') if candidate else False
    if not isinstance(banned, (bool, int)) or banned not in (False, True, 0, 1):
        raise ValueError('Invalid blacklist flag')
    return {'owner': owner, 'total_votes': str(total), 'self_votes': str(own),
            'other_votes': str(total - own), 'permanently_blacklisted': bool(banned)}


def snapshot(rpc, accounts, expected_chain_id, attempts=3):
    # This service MUST use a nonproducing node that accepts no unconfirmed
    # transactions. A producer's speculative DB can change without a new head.
    info = rpc('get_info', {})
    if info.get('chain_id') != expected_chain_id:
        raise ValueError('Source chain identity mismatch')
    for _ in range(attempts):
        # Native state barriers run on the DB read queue. get_info alone uses
        # an asynchronous metadata cache and is insufficient as a DB barrier.
        before = rpc('get_upgrade_state', {})
        profile = rpc('get_raw_abi', {'account_name': 'eosio', 'abi_hash': PROFILE_ABI})
        if (profile.get('code_hash'), profile.get('abi_hash')) not in SUPPORTED_PROFILES:
            return {'schema_version': 1, 'available': False, 'chain_id': expected_chain_id,
                    'reason': 'System contract vote schema has not been qualified'}
        metadata = rpc('get_producers', {'json': True, 'limit': 1})
        if metadata.get('vote_schema') != 'integer-v2' or metadata.get('vote_precision') != 4:
            raise ValueError('Unsupported native vote schema or precision')
        jobs = {(owner, table): READERS.submit(point, rpc, table, owner)
                for owner in accounts for table in ('producersv2', 'votersv2', 'rotcands')}
        # Drain every submitted read even when one fails; no unbounded retry fanout.
        values, failures = {}, []
        for key, future in jobs.items():
            try:
                values[key] = future.result()
            except Exception as error:
                failures.append(error)
        if failures:
            raise failures[0]
        after = rpc('get_upgrade_state', {})
        if before.get('head_block_id') != after.get('head_block_id'):
            continue
        if not re.fullmatch('[0-9a-f]{64}', str(after.get('head_block_id'))):
            raise ValueError('Missing committed-head identity')
        rows = [breakdown(owner, *(values[owner, table] for table in
                                  ('producersv2', 'votersv2', 'rotcands'))) for owner in accounts]
        return {'schema_version': 1, 'available': True, 'chain_id': expected_chain_id,
                'vote_schema': 'integer-v2', 'vote_precision': 4, 'rows': rows,
                'head_block_num': after['head_block_num'], 'head_block_id': after['head_block_id'],
                'generated_at': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds'),
                'system_code_hash': profile['code_hash'],
                'scope': 'Committed history-node head; self means voting-account identity, not funding origin'}
    raise ValueError('Committed head changed during all bounded snapshot attempts')
