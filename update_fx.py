"""Publish only Taiwan central bank public NTD per USD observations."""
import json
import math
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.request import urlopen

API = "https://cpx.cbc.gov.tw/api/OpenData/FTDOpenData_Day"
DATASET = "https://data.gov.tw/dataset/7232"


def main():
    path = Path(sys.argv[1])
    today = datetime.now(timezone(timedelta(hours=8))).date()
    with urlopen(API, timeout=25) as response:
        rows = json.load(response)
    rates = {}
    for row in rows:
        raw = row["日期"]
        day = date(int(raw[:4]), int(raw[4:6]), int(raw[6:]))
        rate = float(row["NTD_USD"])
        if not math.isfinite(rate) or rate <= 0 or day > today:
            raise ValueError("央行匯率資料格式不符")
        rates[day.isoformat()] = rate
    latest = max(rates)
    if min(rates) > "2025-01-01" or (today - date.fromisoformat(latest)).days > 7:
        raise ValueError("央行匯率日期覆蓋不足")
    if path.exists() and json.loads(path.read_text(encoding="utf-8"))["latest"] > latest:
        raise ValueError("新版資料日期早於已發布版本")
    result = {"source": DATASET, "latest": latest, "rates": rates}
    path.write_text(json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":"))+"\n", encoding="utf-8")
    print(f"{len(rates)} rates; latest {latest}")


if __name__ == "__main__":
    main()

