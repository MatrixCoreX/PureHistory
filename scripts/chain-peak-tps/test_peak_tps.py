import datetime,sqlite3,unittest
from peak_tps import epoch,insert_block,summary
class PeakTest(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(':memory:');self.db.execute('CREATE TABLE blocks(height INTEGER PRIMARY KEY,id TEXT,previous TEXT,time REAL,receipts INTEGER)');self.now=epoch('2026-10-31T12:00:00Z');self.info={'chain_id':'a'*64,'head_block_num':4,'last_irreversible_block_num':3}
 def add(self,n,when,count):return insert_block(self.db,{'block_num':n,'id':str(n),'previous':str(n-1),'timestamp':when,'transactions':[{}]*count},n,str(n-1))
 def value(self):return summary(self.db,self.info,3,self.now,500)
 def test_native_receipts_and_empty_blocks(self):
  self.add(1,'2026-10-31T11:00:00Z',0);self.add(2,'2026-10-31T11:00:00.500Z',7);self.add(3,'2026-10-31T11:00:01Z',0);r=self.value();self.assertEqual(r['peak_tps'],14);self.assertEqual(r['block_count'],3)
 def test_24hour_boundary_is_inclusive_and_older_peak_expires(self):
  self.add(1,'2026-10-30T11:59:59.500Z',99);self.add(2,'2026-10-30T12:00:00Z',3);self.add(3,'2026-10-31T11:00:00Z',1);self.assertEqual(self.value()['peak_tps'],6)
 def test_unfinalized_block_cannot_raise_peak(self):
  self.add(3,'2026-10-31T11:00:00Z',2);self.add(4,'2026-10-31T11:00:00.500Z',99);self.assertEqual(self.value()['peak_tps'],4)
 def test_empty_window_is_zero_without_fabricated_block(self):
  self.assertEqual(self.value()['peak_tps'],0);self.assertIsNone(self.value()['peak'])
 def test_gap_is_unavailable(self):
  self.add(1,'2026-10-31T11:00:00Z',1);self.add(3,'2026-10-31T11:00:01Z',2)
  with self.assertRaisesRegex(AssertionError,'Gap'):self.value()
 def test_incomplete_backfill_is_unavailable(self):
  with self.assertRaisesRegex(AssertionError,'Incomplete'):summary(self.db,self.info,2,self.now,500)
 def test_wrong_parent_is_rejected(self):
  with self.assertRaisesRegex(AssertionError,'parent'):insert_block(self.db,{'block_num':1,'previous':'wrong','id':'x','timestamp':'2026-10-31T11:00:00Z','transactions':[]},1,'expected')
 def test_lifetime_peak_does_not_expire_after_24hours(self):
  self.add(1,'2026-10-28T11:00:00Z',99);self.add(2,'2026-10-31T11:00:00Z',3);self.add(3,'2026-10-31T11:00:01Z',0);r=summary(self.db,self.info,3,self.now,500,'all_time');self.assertEqual(r['peak_tps'],198);self.assertEqual(r['scope'],'chain_lifetime');self.assertIsNone(r['window_seconds'])
 def test_lifetime_requires_genesis_coverage(self):
  self.add(3,'2026-10-31T11:00:00Z',3)
  with self.assertRaisesRegex(AssertionError,'genesis'):summary(self.db,self.info,3,self.now,500,'all_time')
if __name__=='__main__':unittest.main()
