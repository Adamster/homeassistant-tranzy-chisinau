#!/usr/bin/env python3
"""
find_stop_id.py — помощник для поиска stop_id в Tranzy API.

Запуск:
    python3 find_stop_id.py --key ВАШ_КЛЮЧ --search "Calea"

Требования: pip install requests
"""
import argparse
import json
import sys

try:
    import requests
except ImportError:
    print("Установи: pip install requests")
    sys.exit(1)

BASE_URL = "https://api.tranzy.ai/v1/opendata"
AGENCY_ID = 4


def fetch(api_key, path):
    headers = {"X-API-KEY": api_key, "X-Agency-Id": str(AGENCY_ID), "Accept": "application/json"}
    r = requests.get(f"{BASE_URL}{path}", headers=headers, timeout=15)
    r.raise_for_status()
    return r.json()


def main():
    parser = argparse.ArgumentParser(description="Найти stop_id для Tranzy Кишинёв")
    parser.add_argument("--key", required=True, help="Tranzy API ключ")
    parser.add_argument("--search", default="", help="Фильтр по имени остановки")
    parser.add_argument("--routes", action="store_true", help="Показать список маршрутов")
    args = parser.parse_args()

    if args.routes:
        print("\n📍 Маршруты (route_short_name → route_id):\n")
        routes = fetch(args.key, "/routes")
        for r in sorted(routes, key=lambda x: str(x.get("route_short_name", ""))):
            print(f"  {r.get('route_short_name', '?'):>4}  id={r.get('route_id')}  {r.get('route_long_name', '')}")
        return

    print("\n📍 Остановки:\n")
    stops = fetch(args.key, "/stops")
    filtered = [s for s in stops
                if args.search.lower() in (s.get("stop_name") or "").lower()]

    if not filtered:
        print(f"  Ничего не найдено по запросу '{args.search}'")
        print(f"  Всего остановок: {len(stops)}")
        return

    print(f"  {'stop_id':>8}  {'Название':<40}  {'lat':>10}  {'lon':>10}")
    print("  " + "-" * 75)
    for s in sorted(filtered, key=lambda x: x.get("stop_name", "")):
        print(f"  {s.get('stop_id', ''):>8}  {s.get('stop_name', ''):40}  "
              f"{s.get('stop_lat', ''):>10}  {s.get('stop_lon', ''):>10}")


if __name__ == "__main__":
    main()
