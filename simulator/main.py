import json
import math
import random
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import paho.mqtt.client as mqtt


BROKER_HOST = "localhost"
BROKER_PORT = 1883
CONFIG_PATH = Path(__file__).with_name("sensors.json")
SIMULATION_STARTED = False
SIMULATION_LOCK = threading.Lock()
SENSOR_STATE = {}


def clamp(value, min_val, max_val):
    return max(min_val, min(max_val, value))


def simulate_sinusoidal(t, min_val, max_val, phase):
    center = (min_val + max_val) / 2
    amplitude = (max_val - min_val) * 0.42
    lap_wave = math.sin((t / 7.5) + phase)
    sector_wave = math.sin((t / 3.4) + phase * 0.7) * 12
    value = center + (amplitude * lap_wave) + sector_wave
    return value


def simulate_ramp(t, min_val, max_val, target):
    target = target if target is not None else max_val
    progress = 1 - math.exp(-t / 65)
    noise = math.sin(t * 2.1) * 0.7 + random.uniform(-0.3, 0.3)
    return min_val + ((target - min_val) * progress) + noise


def simulate_stable_noise(t, min_val, max_val, target):
    target = target if target is not None else (min_val + max_val) / 2
    drift = math.sin(t / 20) * 0.12
    noise = random.uniform(-0.05, 0.05)
    occasional_drop = -0.55 if int(t) % 95 in (0, 1, 2) and t > 10 else 0
    return target + drift + noise + occasional_drop


def simulate_ramp_noise(t, min_val, max_val, target):
    target = target if target is not None else max_val
    warmup = simulate_ramp(t, min_val, max_val, target)
    tyre_load = math.sin(t / 4) * 2.2
    track_noise = random.uniform(-1.2, 1.2)
    return warmup + tyre_load + track_noise


def simulate_fuel_burn(t, min_val, max_val, phase, state_key):
    state = SENSOR_STATE.setdefault(state_key, {"fuel": max_val, "last_t": t})
    elapsed = max(0, t - state["last_t"])
    burn_rate = 0.09 + (phase * 0.01)

    state["fuel"] = max(min_val, state["fuel"] - elapsed * burn_rate)
    state["last_t"] = t

    if state["fuel"] <= 4:
        state["fuel"] = max_val

    return state["fuel"]


def simulate_value(sensor, t, car_id):
    min_val = sensor["min"]
    max_val = sensor["max"]
    target = sensor.get("target")
    phase = car_id * 0.8
    simulation = sensor.get("simulation", "stable_noise")
    state_key = (car_id, sensor["id"])

    if simulation == "sinusoidal":
        value = simulate_sinusoidal(t, min_val, max_val, phase)
    elif simulation == "ramp":
        value = simulate_ramp(t, min_val, max_val, target)
    elif simulation == "ramp_noise":
        value = simulate_ramp_noise(t, min_val, max_val, target)
    elif simulation == "fuel_burn":
        value = simulate_fuel_burn(t, min_val, max_val, phase, state_key)
    else:
        value = simulate_stable_noise(t, min_val, max_val, target)

    decimals = 1 if sensor["unit"] in ("C", "bar", "%") else 0
    return round(clamp(value, min_val, max_val), decimals)


def sensor_worker(client, car, sensor):
    t = 0
    interval = sensor["frequency_ms"] / 1000

    while True:
        value = simulate_value(sensor, t, car["id"])
        payload = json.dumps(
            {
                "carId": car["id"],
                "carName": car["name"],
                "sensorId": sensor["id"],
                "label": sensor["label"],
                "value": value,
                "unit": sensor["unit"],
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        )

        client.publish(sensor["topic"], payload)
        print(f"[{sensor['topic']}] {value} {sensor['unit']}")
        t += interval
        time.sleep(interval)


def run_car(car, client):
    print(f"[CAR {car['id']}] Iniciando {len(car['sensors'])} sensores...")
    threads = []

    for sensor in car["sensors"]:
        thread = threading.Thread(
            target=sensor_worker,
            args=(client, car, sensor),
            daemon=True,
        )
        thread.start()
        threads.append(thread)

    for thread in threads:
        thread.join()


def on_connect(client, userdata, flags, rc):
    global SIMULATION_STARTED

    print(f"[MQTT] Conectado ao broker (rc={rc})")

    with SIMULATION_LOCK:
        if SIMULATION_STARTED:
            print("[MQTT] Reconectado. Workers ja estao em execucao.")
            return

        with CONFIG_PATH.open(encoding="utf-8") as config_file:
            config = json.load(config_file)

        for car in config["cars"]:
            threading.Thread(target=run_car, args=(car, client), daemon=True).start()

        SIMULATION_STARTED = True


def main():
    client = mqtt.Client()
    client.on_connect = on_connect
    client.connect(BROKER_HOST, BROKER_PORT, 60)

    try:
        client.loop_forever()
    except KeyboardInterrupt:
        print("\n[MQTT] Encerrando simulador...")
        client.disconnect()


if __name__ == "__main__":
    main()
