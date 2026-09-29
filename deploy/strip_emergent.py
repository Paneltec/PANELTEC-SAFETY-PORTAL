"""Remove Emergent's badge, editor script and analytics from the self-hosted build."""
import re, sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
s = re.sub(r'\s*<script src="https://assets\.emergent\.sh/[^"]*"></script>', "", s)
s = re.sub(r'\s*<a\s+id="emergent-badge".*?</a>', "", s, flags=re.S)
s = re.sub(r'\s*<script>\s*!\(function \(t, e\) \{.*?posthog.*?</script>', "", s, flags=re.S)
open(p, "w", encoding="utf-8").write(s)
print("stripped Emergent extras from", p)
