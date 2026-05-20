import json
import time
import math
import threading
import paho.mqtt.client as mqtt

BROKER_HOST = "localhost"
BROKER_PORT = 1883

def simulate_ramp(t, min_val, max_val, target=None):
    """Rampa logarítmica: sobe de min_val até target e estabiliza."""
    target = target if target is not None else max_val
    progress = 1 - math.exp(-t / 60)
    noise = math.sin(t * 3.7) * 0.5
    value = min_val + (target - min_val) * progress + noise
    return round(max(min_val, min(max_val, value)), 1)

def sensor_worker(client, sensor):
    t = 0
    while True:
        value = simulate_ramp(t, sensor["min"], sensor["max"], sensor["target"])
        payload = json.dumps({
            "carId": 1,
            "sensorId": sensor["id"],
            "value": value,
            "unit": sensor["unit"],
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        })
        client.publish(sensor["topic"], payload)
        print(f"[{sensor['topic']}] {value} {sensor['unit']}")
        t += sensor["frequency_ms"] / 1000
        time.sleep(sensor["frequency_ms"] / 1000)

def run_car(car, client):
    print(f"[CAR {car['id']}] Iniciando {len(car['sensors'])} sensor(es)...")
    threads = []
    for sensor in car["sensors"]:
        t = threading.Thread(target=sensor_worker, args=(client, sensor), daemon=True)
        t.start()
        threads.append(t)
    for t in threads:
        t.join()

def on_connect(client, userdata, flags, rc):
    print(f"[MQTT] Conectado ao broker (rc={rc})")
    with open("sensors.json") as f:
        config = json.load(f)
    for car in config["cars"]:
        threading.Thread(target=run_car, args=(car, client), daemon=True).start()

client = mqtt.Client()
client.on_connect = on_connect
client.connect(BROKER_HOST, BROKER_PORT, 60)
try:
    client.loop_forever()
except KeyboardInterrupt:
    print("\n[MQTT] Encerrando simulador...")
    client.disconnect()