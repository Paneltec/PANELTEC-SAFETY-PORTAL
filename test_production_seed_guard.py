import ast, asyncio, os
from pathlib import Path
source=Path('backend/seed.py').read_text()
module=ast.parse(source)
function=next(n for n in module.body if isinstance(n,ast.AsyncFunctionDef) and n.name=='seed_all')
async def fail(*a,**k): raise RuntimeError('seed reached')
namespace={'os':os,'_ensure_org_and_workspaces':fail}
exec(compile(ast.Module(body=[function],type_ignores=[]),'seed.py','exec'),namespace)
for value in ('true','TRUE','1','yes','on'):
 os.environ['IS_PROD']=value
 assert asyncio.run(namespace['seed_all']())=={'counts':{},'skipped':'production'}
os.environ['IS_PROD']='false'
try: asyncio.run(namespace['seed_all']())
except RuntimeError as e: assert str(e)=='seed reached'
else: raise AssertionError('non-production seeding did not run')
print('PASS: production seed guard stops before database access; non-production path preserved.')
