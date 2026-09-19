import csv
import json
import sys
from pathlib import Path

rows = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
with Path(sys.argv[2]).open("w", encoding="utf-8", newline="") as output:
    writer = csv.DictWriter(output, fieldnames=["name", "total"], lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
print("python-ok")
