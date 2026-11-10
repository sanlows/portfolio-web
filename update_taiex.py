"""Fetch TWSE's official daily TAIEX closing index, grouped by calendar month."""
import json
import math
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.request import urlopen

API = "https://www.twse.com.tw/indicesReport/MI_5MINS_HIST"
SOURCE = "https://www.twse.com.tw/zh/indices/taiex/mi-5min-hist.html"


def month_prices(month, today):
    with urlopen(f"{API}?date={month:%Y%m}01&response=json", timeout=20) as response:
        payload = json.load(response)
    if payload.get("stat") != "OK" or not payload.get("data"):
        raise ValueError(f"No TWSE rows for {month:%Y-%m}")
    values = {}
    for row in payload["data"]:
        year, mm, dd = map(int, row[0].split("/"))
        day = date(year + 1911, mm, dd)
        close = float(row[4].replace(",", ""))
        if day.replace(day=1) != month or day > today or not math.isfinite(close) or close <= 0:
            raise ValueError("Invalid TWSE close record")
        values[day.isoformat()] = close
    return values


def main():
    path = Path(sys.argv[1])
    today = datetime.now(timezone(timedelta(hours=8))).date()
    end = today.replace(day=1)
    old = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    closes = dict(old.get("closes", {}))
    month = date(2025, 1, 1) if not closes else date.fromisoformat(max(closes)).replace(day=1)
    while month <= end:
        closes.update(month_prices(month, today))
        month = (month.replace(day=28) + timedelta(days=4)).replace(day=1)
        if month <= end:
            time.sleep(0.6)
    result = {"source": SOURCE, "latest": max(closes), "closes": closes}
    path.write_text(json.dumps(result, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{len(closes)} observations; latest {result['latest']}")


if __name__ == "__main__":
    main()
