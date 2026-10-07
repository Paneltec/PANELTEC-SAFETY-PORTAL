import ast, os, unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
class Failure(Exception):
 def __init__(self,status_code,detail):self.status_code=status_code;self.detail=detail
class AIKeyTests(unittest.TestCase):
 def get_key(self,direct,env):
  source=ast.parse((ROOT/'ai.py').read_text(encoding='utf-8'))
  fn=next(n for n in source.body if isinstance(n,ast.FunctionDef) and n.name=='_emergent_key')
  scope={'os':os,'LlmChat':type('Chat',(),{'DIRECT_ANTHROPIC':direct}),'HTTPException':Failure}
  exec(compile(ast.Module(body=[fn],type_ignores=[]),'ai.py','exec'),scope)
  with patch.dict(os.environ,env,clear=True):return scope['_emergent_key']()
 def test_direct_key_without_legacy_alias(self):
  self.assertEqual(self.get_key(True,{'ANTHROPIC_API_KEY':'synthetic-key'}),'synthetic-key')
 def test_direct_key_wins(self):
  self.assertEqual(self.get_key(True,{'ANTHROPIC_API_KEY':'direct','EMERGENT_LLM_KEY':'legacy'}),'direct')
 def test_direct_legacy_alias_remains_supported(self):
  self.assertEqual(self.get_key(True,{'EMERGENT_LLM_KEY':'legacy'}),'legacy')
 def test_missing_direct_key_has_actionable_error(self):
  with self.assertRaises(Failure) as cm:self.get_key(True,{})
  self.assertEqual(cm.exception.status_code,503)
  self.assertIn('ANTHROPIC_API_KEY',cm.exception.detail)
 def test_hosted_does_not_send_direct_key_to_other_provider(self):
  with self.assertRaises(Failure):self.get_key(False,{'ANTHROPIC_API_KEY':'direct'})
 def test_hosted_legacy_still_works(self):
  self.assertEqual(self.get_key(False,{'EMERGENT_LLM_KEY':'legacy'}),'legacy')
if __name__=='__main__':unittest.main()

