import { useEffect, useRef, useState } from "react";
import mqtt from "mqtt";

const BROKER_URL = "ws://localhost:9001";
const TOPIC = "car/1/engine_temp";

function getTempColor(value) {
  if (value <= 0) return "rgb(0, 100, 255)";
  if (value <= 80)
    return `rgb(${Math.round((value / 80) * 0)}, ${Math.round(100 + (value / 80) * 155)}, ${Math.round(255 - (value / 80) * 255)})`;
  if (value <= 90)
    return `rgb(${Math.round(((value - 80) / 10) * 255)}, 255, 0)`;
  if (value <= 100)
    return `rgb(255, ${Math.round(255 - ((value - 90) / 10) * 255)}, 0)`;
  return "rgb(255, 0, 0)";
}

function TemperatureBar({ value, unit, max = 130 }) {
  const color = getTempColor(value);

  return (
    <div className="flex flex-col items-center gap-3">
      <span className="text-xs font-semibold uppercase tracking-widest text-gray-400">
        Engine Temp
      </span>
      <div
        className="w-8 h-20 rounded-md border border-gray-700 transition-colors duration-700"
        style={{ backgroundColor: color }}
      />

      <div className="flex flex-col items-center gap-1">
        <span className="text-xs text-gray-500">
          max {max}
          °C
        </span>
        <span
          className="font-bold text-xl transition-colors duration-700"
          style={{ color }}
        >
          {value}
          °C
        </span>
      </div>
    </div>
  );
}

export default function App() {
  const [sensorData, setSensorData] = useState(null);
  const [status, setStatus] = useState("disconnected");
  const clientRef = useRef(null);

  useEffect(() => {
    const mqttClient = mqtt.connect(BROKER_URL);
    clientRef.current = mqttClient;

    mqttClient.on("connect", () => {
      setStatus("connected");
      mqttClient.subscribe(TOPIC);
    });

    mqttClient.on("message", (_, message) => {
      const parsed = JSON.parse(message.toString());
      setSensorData(parsed);
    });

    mqttClient.on("error", () => setStatus("error"));

    return () => mqttClient.end();
  }, []);

  const statusDot = {
    connected: "bg-green-400",
    error: "bg-red-400",
    disconnected: "bg-yellow-400",
  };

  return (
    <div
      className="min-h-screen bg-gray-950 bg-center bg-contain bg-no-repeat flex flex-col"
      style={{ backgroundImage: "url('/car.png')" }}
    >
      <div className="p-6 flex items-center justify-between">
        <div>
          <h1 className="text-white font-bold text-xl tracking-wide">
            🏎️ RaceTrack IoT
          </h1>
          <p className="text-gray-500 text-xs">Car 01 — Live Telemetry</p>
        </div>
        <div className="flex items-center gap-2 bg-gray-900/80 border border-gray-800 rounded-full px-3 py-1.5">
          <span
            className={`w-2 h-2 rounded-full ${statusDot[status]} animate-pulse`}
          />
          <span className="text-xs text-gray-400 capitalize">{status}</span>
        </div>
      </div>

      <div className="flex-1 flex items-end justify-center pb-12">
        <div className="bg-gray-900/80 backdrop-blur border border-gray-700 rounded-2xl p-6 shadow-xl">
          {sensorData ? (
            <TemperatureBar
              value={sensorData.value}
              unit={sensorData.unit}
              min={80}
              max={130}
            />
          ) : (
            <p className="text-gray-500 text-sm">Aguardando dados...</p>
          )}
        </div>
      </div>
    </div>
  );
}
