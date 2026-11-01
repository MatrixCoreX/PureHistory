import unittest
from producer_summary import summarize
class SummaryTests(unittest.TestCase):
 def get(self,rows,code='6ed4cccc3aac05231f95e63b5464325315668bea2997ddb15de0b29768bf3a62'):
  rotation={'growth_start_slot':1000,'last_slot':1000,'capacity':210,'published_epoch':1};schedule={'active':{'producers':[{'producer_name':'b'},{'producer_name':'c'}]}}
  def rpc(method,data):
   if method=='get_code_hash':return{'code_hash':code}
   return{'rows':rows.get(data['table'],[]),'more':False}
  return summarize(rpc,rotation,schedule)
 def test_pending_and_effective_are_distinct(self):
  rows={'producersv2':[{'owner':x,'is_active':1}for x in ['a','b','c']],'rotcands':[{'owner':x,'rank':0,'seen_epoch':1,'banned':False}for x in ['a','b','c']],'bpmaint':[{'owner':'a','state':2},{'owner':'b','state':1},{'owner':'c','state':0}]};r=self.get(rows);self.assertEqual((r['maintenance_active_count'],r['maintenance_pending_count'],r['maintenance_excluded_count']),(1,1,2));self.assertEqual(r['active_producer_count'],2)
 def test_old_unregistered_maintenance_record_is_not_a_current_bp(self):
  r=self.get({'bpmaint':[{'owner':'old','state':2}]});self.assertEqual(r['maintenance_active_count'],0)
 def test_zero_is_from_complete_empty_tables(self):
  r=self.get({});self.assertEqual((r['maintenance_active_count'],r['maintenance_pending_count']),(0,0))
 def test_qualified_upgrade_keeps_banned_rows_out_of_eligible_count(self):
  rows={'producersv2':[{'owner':x,'is_active':1}for x in ['banned','healthy']],'rotcands':[{'owner':x,'rank':0,'seen_epoch':1,'banned':x=='banned'}for x in ['banned','healthy']]}
  before=self.get(rows);after=self.get(rows,'373b66b2994c3131ce6c9c3d4526fdf836c0ac2c36d8265b2239d61e75ca2ceb')
  self.assertEqual((after['registered_bp_count'],after['eligible_bp_count'],after['permanent_blacklist_count']),(2,1,1))
  for k in ['registered_bp_count','eligible_bp_count','permanent_blacklist_count','rotation_capacity']:self.assertEqual(before[k],after[k])
 def test_rejected_candidate_stays_unsupported(self):
  self.assertFalse(self.get({},'590c0be3305d78594ba9ce7a244e755de37e04fac45f085d6fec68c4b2470801')['available'])
if __name__=='__main__':unittest.main()
