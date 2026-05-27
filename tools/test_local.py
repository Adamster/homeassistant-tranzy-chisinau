#!/usr/bin/env python3
"""
test_local.py — локальная проверка Tranzy API без Home Assistant.

Запуск:
    python tranzy_ha/test_local.py --key ВАШ_КЛЮЧ --stop "Название остановки" --routes 5 26 32

Требования: pip install requests
"""
import argparse
import math
import json
import sys
from datetime import datetime, timezone

try:
    import requests
except ImportError:
    print("Установи: pip install requests")
    sys.exit(1)

BASE_URL = "https://api.tranzy.ai/v1/opendata"
AGENCY_ID = 4
AVG_SPEED_KMH = 18


def fetch(api_key, path, params=None):
    headers = {
        "X-API-KEY": api_key,
        "X-Agency-Id": str(AGENCY_ID),
        "Accept": "application/json",
    }
    r = requests.get(f"{BASE_URL}{path}", headers=headers, params=params, timeout=15)
    r.raise_for_status()
    return r.json()


def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2))
         * math.sin(dlon / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def main():
    parser = argparse.ArgumentParser(description="Тест Tranzy API для Кишинёва")
    parser.add_argument("--key", required=True, help="API ключ")
    parser.add_argument("--stop", default="", help="Название остановки (поиск)")
    parser.add_argument("--stop-id", type=int, help="ID остановки (если уже известен)")
    parser.add_argument("--routes", nargs="+", default=[], help="Маршруты для отслеживания: --routes 5 26 32")
    args = parser.parse_args()

    print("=== Tranzy API — локальный тест ===\n")

    # 1. Проверка соединения
    print("1. Проверка агентств...")
    headers_no_agency = {"X-API-KEY": args.key, "Accept": "application/json"}
    r = requests.get(f"{BASE_URL}/agency", headers=headers_no_agency, timeout=15)
    r.raise_for_status()
    agencies = r.json()
    chisinau = next((a for a in agencies if a["agency_id"] == AGENCY_ID), None)
    if chisinau:
        print(f"   OK — {chisinau['agency_name']} (id={chisinau['agency_id']})")
    else:
        print("   ОШИБКА: Кишинёв не найден в списке агентств")
        sys.exit(1)

    # 2. Маршруты
    print("\n2. Загрузка маршрутов...")
    routes_data = fetch(args.key, "/routes")
    print(f"   Всего маршрутов: {len(routes_data)}")

    route_map = {}
    for r in routes_data:
        short = str(r.get("route_short_name", ""))
        route_map[short] = r

    if args.routes:
        print("   Выбранные маршруты:")
        for short in args.routes:
            r = route_map.get(short)
            if r:
                print(f"     {short:>4} → id={r['route_id']}  {r.get('route_long_name', '')}")
            else:
                print(f"     {short:>4} → НЕ НАЙДЕН")

    # 3. Остановка
    stop_info = None
    if args.stop_id:
        stops_data = fetch(args.key, "/stops")
        stop_info = next((s for s in stops_data if s.get("stop_id") == args.stop_id), None)
    elif args.stop:
        print(f"\n3. Поиск остановки '{args.stop}'...")
        stops_data = fetch(args.key, "/stops")
        matches = [s for s in stops_data if args.stop.lower() in (s.get("stop_name") or "").lower()]
        if not matches:
            print(f"   Ничего не найдено. Всего остановок: {len(stops_data)}")
        else:
            print(f"   Найдено {len(matches)} остановок:")
            for s in matches[:10]:
                print(f"     stop_id={s['stop_id']:>6}  {s['stop_name']:<40}  lat={s.get('stop_lat')}  lon={s.get('stop_lon')}")
            stop_info = matches[0]
            print(f"\n   Используем: {stop_info['stop_name']} (id={stop_info['stop_id']})")

    # 4. Транспорт в реальном времени + ETA
    print("\n4. Транспорт в реальном времени...")
    vehicles = fetch(args.key, "/vehicles")
    with_route = [v for v in vehicles if v.get("route_id")]
    print(f"   Всего: {len(vehicles)}, с маршрутом: {len(with_route)}")

    if stop_info and args.routes:
        stop_lat = float(stop_info.get("stop_lat", 0))
        stop_lon = float(stop_info.get("stop_lon", 0))

        print(f"\n5. ETA до остановки '{stop_info['stop_name']}':")

        arrivals = []
        for short in args.routes:
            r = route_map.get(short)
            if not r:
                continue
            route_id = r["route_id"]
            matching = [v for v in vehicles if str(v.get("route_id")) == str(route_id)]

            if not matching:
                print(f"   Маршрут {short:>4}: нет транспорта на линии")
                continue

            best = None
            for v in matching:
                try:
                    vlat = float(v.get("latitude", 0))
                    vlon = float(v.get("longitude", 0))
                except (TypeError, ValueError):
                    continue
                if not vlat or not vlon:
                    continue
                dist = haversine_km(stop_lat, stop_lon, vlat, vlon)
                eta = (dist / AVG_SPEED_KMH) * 60
                age_sec = (datetime.now(timezone.utc) -
                           datetime.fromisoformat(v["timestamp"].replace("Z", "+00:00"))).total_seconds()
                if best is None or eta < best["eta"]:
                    best = {"eta": eta, "dist": dist, "vehicle": v, "age_sec": age_sec}

            if best:
                age_min = best["age_sec"] / 60
                print(f"   Маршрут {short:>4}: ~{best['eta']:.1f} мин  "
                      f"(расстояние {best['dist']:.2f} км, "
                      f"данные {age_min:.0f} мин назад, "
                      f"скорость {best['vehicle']['speed']} км/ч)")
    elif args.routes and not stop_info:
        print("\n   (Укажи --stop или --stop-id чтобы посчитать ETA)")

    print("\n=== Тест завершён ===")


if __name__ == "__main__":
    main()
