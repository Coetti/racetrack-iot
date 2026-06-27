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
CAR_PHYSICS: dict = {}


def clamp(value, min_val, max_val):
    return max(min_val, min(max_val, value))


# ─── Car Physics Engine ───────────────────────────────────────────────────────

class CarPhysics:
    """
    Modela as dinâmicas acopladas de speed, throttle, brake, gear e RPM
    através de uma state machine de segmentos de pista.

    Segmento → throttle/brake target → speed (lag 1ª ordem) → gear → RPM
    """

    LAP_TIME = 90.0  # segundos por volta

    # (fração da volta, tipo, velocidade_alvo normalizada 0–1)
    _RAW_TRACK = [
        (0.12, "straight",   1.00),   # reta principal – fundo total
        (0.04, "brake_zone", 0.30),   # frenagem pesada
        (0.06, "corner",     0.30),   # curva lenta
        (0.04, "accel",      0.65),   # saída acelerada
        (0.10, "straight",   0.85),   # reta média
        (0.03, "brake_zone", 0.42),   # frenagem média
        (0.07, "corner",     0.42),   # curva média
        (0.04, "accel",      0.72),
        (0.15, "straight",   1.00),   # reta dos boxes
        (0.05, "brake_zone", 0.25),   # frenagem pesada – hairpin
        (0.08, "corner",     0.25),   # hairpin
        (0.05, "accel",      0.58),
        (0.08, "straight",   0.80),
        (0.03, "brake_zone", 0.48),
        (0.06, "corner",     0.48),
    ]

    # Limites de upshift (km/h) → 7 marchas
    GEAR_THRESHOLDS = [80, 130, 175, 220, 265, 310]
    RPM_IDLE = 3_500
    RPM_MAX  = 7_800

    def __init__(self, car_id: int, speed_min: float, speed_max: float):
        total = sum(s[0] for s in self._RAW_TRACK)
        self.TRACK = [(f / total, t, v) for f, t, v in self._RAW_TRACK]

        self.speed_min = speed_min
        self.speed_max = speed_max
        self.t = car_id * 17.3  # offset de fase entre carros

        self.speed    = speed_min + (speed_max - speed_min) * 0.4
        self.gear     = 3
        self.rpm = 3_000          # valor inicial suave
        self._rpm_smoothed = 3_000  # estado do filtro EMA
        self.throttle = 50.0   # %
        self.brake    = 0.0    # %
        self._lock    = threading.Lock()

    # ── helpers internos ──────────────────────────────────────────────────────

    def _get_segment(self, lap_phase: float):
        cumulative = 0.0
        for frac, seg_type, target_norm in self.TRACK:
            cumulative += frac
            if lap_phase <= cumulative:
                local_p = 1.0 - (cumulative - lap_phase) / frac
                return seg_type, clamp(local_p, 0.0, 1.0), target_norm
        last = self.TRACK[-1]
        return last[1], 1.0, last[2]

    def _compute_gear(self, speed: float) -> int:
        gear = 1
        for i, threshold in enumerate(self.GEAR_THRESHOLDS):
            if speed >= threshold:
                gear = i + 2
        return gear

    def _compute_rpm(self, speed: float, gear: int) -> int:
        low = self.GEAR_THRESHOLDS[gear - 2] if gear > 1 else 0
        high = (
            self.GEAR_THRESHOLDS[gear - 1]
            if gear - 1 < len(self.GEAR_THRESHOLDS)
            else self.speed_max
        )
        progress = clamp((speed - low) / max(1.0, high - low), 0.0, 1.0)
        
        # Ruído proporcional ao range — bem menor agora
        rpm_range = self.RPM_MAX - self.RPM_IDLE
        noise = random.uniform(-0.01, 0.01) * rpm_range  # ±1% do range
        
        target_rpm = self.RPM_IDLE + progress * rpm_range + noise

        # EMA: alpha baixo = mais lento/suave, alto = mais reativo
        # Para V8: alpha ~0.08 simula inércia de motor pesado
        alpha = 0.08
        self._rpm_smoothed = alpha * target_rpm + (1 - alpha) * self._rpm_smoothed

        return int(clamp(self._rpm_smoothed, self.RPM_IDLE, self.RPM_MAX))

    # ── atualização do estado ─────────────────────────────────────────────────

    def update(self, dt: float) -> None:
        lap_phase = (self.t % self.LAP_TIME) / self.LAP_TIME
        seg_type, local_p, target_norm = self._get_segment(lap_phase)

        target_speed = self.speed_min + target_norm * (self.speed_max - self.speed_min)

        # Perfis de throttle/brake por tipo de segmento
        if seg_type == "straight":
            throttle = clamp(0.92 + random.uniform(-0.04, 0.04), 0.0, 1.0)
            brake    = 0.0

        elif seg_type == "brake_zone":
            # Throttle cai, brake sobe progressivamente
            throttle = clamp(0.05 * (1.0 - local_p), 0.0, 1.0)
            brake    = clamp(0.2 + local_p * 0.78 + random.uniform(-0.05, 0.05), 0.0, 1.0)

        elif seg_type == "corner":
            # Throttle parcial crescente ao longo da curva (apex → saída)
            throttle = clamp(0.22 + local_p * 0.25 + random.uniform(-0.05, 0.05), 0.0, 1.0)
            brake    = clamp(0.10 * (1.0 - local_p), 0.0, 1.0)

        else:  # accel
            throttle = clamp(0.60 + local_p * 0.35 + random.uniform(-0.04, 0.04), 0.0, 1.0)
            brake    = 0.0

        # Velocidade: lag de 1ª ordem em direção ao alvo do segmento
        speed_delta = (target_speed - self.speed) * clamp(0.08 * dt * 10, 0.02, 0.30)
        new_speed   = self.speed + speed_delta + random.uniform(-1.2, 1.2)

        with self._lock:
            self.speed    = round(clamp(new_speed, self.speed_min, self.speed_max), 1)
            self.gear     = self._compute_gear(self.speed)
            self.rpm      = self._compute_rpm(self.speed, self.gear)
            self.throttle = round(throttle * 100.0, 1)
            self.brake    = round(brake    * 100.0, 1)

        self.t += dt

    def snapshot(self) -> dict:
        with self._lock:
            return {
                "speed":    self.speed,
                "gear":     self.gear,
                "rpm":      self.rpm,
                "throttle": self.throttle,
                "brake":    self.brake,
            }


# ─── Simulações independentes ─────────────────────────────────────────────────

def simulate_sinusoidal(t, min_val, max_val, phase):
    center    = (min_val + max_val) / 2
    amplitude = (max_val - min_val) * 0.42
    return center + amplitude * math.sin((t / 7.5) + phase) + math.sin((t / 3.4) + phase * 0.7) * 12


def simulate_ramp(t, min_val, max_val, target):
    target   = target if target is not None else max_val
    progress = 1 - math.exp(-t / 65)
    noise    = math.sin(t * 2.1) * 0.7 + random.uniform(-0.3, 0.3)
    return min_val + (target - min_val) * progress + noise


def simulate_stable_noise(t, min_val, max_val, target):
    target          = target if target is not None else (min_val + max_val) / 2
    drift           = math.sin(t / 20) * 0.12
    noise           = random.uniform(-0.05, 0.05)
    occasional_drop = -0.55 if int(t) % 95 in (0, 1, 2) and t > 10 else 0
    return target + drift + noise + occasional_drop


def simulate_ramp_noise(t, min_val, max_val, target):
    target    = target if target is not None else max_val
    warmup    = simulate_ramp(t, min_val, max_val, target)
    tyre_load = math.sin(t / 4) * 2.2
    track_noise = random.uniform(-1.2, 1.2)
    return warmup + tyre_load + track_noise


def simulate_fuel_burn(t, min_val, max_val, phase, state_key):
    state     = SENSOR_STATE.setdefault(state_key, {"fuel": max_val, "last_t": t})
    elapsed   = max(0, t - state["last_t"])
    burn_rate = 0.09 + (phase * 0.01)

    state["fuel"]   = max(min_val, state["fuel"] - elapsed * burn_rate)
    state["last_t"] = t

    if state["fuel"] <= 4:
        state["fuel"] = max_val

    return state["fuel"]


# ─── Dispatcher ───────────────────────────────────────────────────────────────

# Mapeamento sensor id → campo do snapshot de física
_PHYSICS_FIELDS = {"speed", "gear", "rpm", "throttle", "brake"}


def simulate_value(sensor, t, car_id):
    min_val    = sensor["min"]
    max_val    = sensor["max"]
    target     = sensor.get("target")
    phase      = car_id * 0.8
    simulation = sensor.get("simulation", "stable_noise")
    state_key  = (car_id, sensor["id"])

    if simulation == "physics":
        physics = CAR_PHYSICS.get(car_id)
        if physics is None:
            return 0
        field = sensor["id"] if sensor["id"] in _PHYSICS_FIELDS else "speed"
        return physics.snapshot()[field]

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


# ─── Workers ──────────────────────────────────────────────────────────────────

def sensor_worker(client, car, sensor):
    t        = 0
    interval = sensor["frequency_ms"] / 1000

    while True:
        value   = simulate_value(sensor, t, car["id"])
        payload = json.dumps({
            "carId":     car["id"],
            "carName":   car["name"],
            "sensorId":  sensor["id"],
            "label":     sensor["label"],
            "value":     value,
            "unit":      sensor["unit"],
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        client.publish(sensor["topic"], payload)
        print(f"[{sensor['topic']}] {value} {sensor['unit']}")
        t += interval
        time.sleep(interval)


def _physics_loop(physics: CarPhysics, dt: float = 0.1):
    """Thread dedicada à atualização do estado físico do carro."""
    while True:
        physics.update(dt)
        time.sleep(dt)


def run_car(car, client):
    # Detecta limites de velocidade do sensor de speed para inicializar física
    speed_cfg = next((s for s in car["sensors"] if s["id"] == "speed"), None)
    speed_min = speed_cfg["min"] if speed_cfg else 80
    speed_max = speed_cfg["max"] if speed_cfg else 315

    physics = CarPhysics(car["id"], speed_min, speed_max)
    CAR_PHYSICS[car["id"]] = physics

    threading.Thread(target=_physics_loop, args=(physics,), daemon=True).start()
    print(f"[CAR {car['id']}] Physics engine iniciado. Iniciando {len(car['sensors'])} sensores...")

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


# ─── MQTT ─────────────────────────────────────────────────────────────────────

def on_connect(client, userdata, flags, rc):
    global SIMULATION_STARTED
    print(f"[MQTT] Conectado ao broker (rc={rc})")

    with SIMULATION_LOCK:
        if SIMULATION_STARTED:
            print("[MQTT] Reconectado. Workers já estão em execução.")
            return

        with CONFIG_PATH.open(encoding="utf-8") as f:
            config = json.load(f)

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