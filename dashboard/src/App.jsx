import { useEffect, useMemo, useRef, useState } from "react";
import mqtt from "mqtt";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const BROKER_URL = "ws://localhost:9001";
const CONFIG_URL = "/sensors.json";
const CHART_SENSOR_IDS = ["speed", "engine_temp", "fuel_level", "oil_pressure"];
const KEY_SENSOR_IDS = ["speed", "engine_temp", "fuel_level", "oil_pressure"];
const TAB_ITEMS = [
  { id: "race", label: "Corrida" },
  { id: "telemetry", label: "Telemetria" },
  { id: "alerts", label: "Alertas" },
  { id: "setup", label: "Setup" },
];
const CHART_COLORS = {
  speed: "#00d5ff",
  engine_temp: "#ff6b00",
  fuel_level: "#d6ff00",
  oil_pressure: "#b875ff",
};

function getInitialCarId() {
  const params = new URLSearchParams(window.location.search);
  return Number(params.get("carId")) || null;
}

function getSensorValue(readings, sensorId) {
  return readings[sensorId]?.value;
}

function formatValue(data, sensor) {
  if (!data) return "--";
  const decimals = sensor.unit === "bar" ? 2 : 1;
  return `${Number(data.value).toFixed(decimals)} ${sensor.unit}`;
}

function formatShortValue(data, sensor) {
  if (!data) return "--";
  const decimals = sensor.unit === "bar" ? 1 : 0;
  return `${Number(data.value).toFixed(decimals)}`;
}

function isAlertActive(value, alert) {
  if (!alert || value == null || Number.isNaN(Number(value))) return false;
  return alert.operator === ">" ? Number(value) > alert.threshold : Number(value) < alert.threshold;
}

function loadSavedLimits(car) {
  try {
    const saved = localStorage.getItem(`racetrack-alerts-${car.id}`);
    return saved ? JSON.parse(saved) : {};
  } catch {
    return {};
  }
}

function getTrendLabel(sensor, data) {
  if (!data) return "aguardando";
  if (sensor.id === "fuel_level") return Number(data.value) < 25 ? "pit window" : "stint ok";
  if (sensor.id === "speed") return "live pace";
  if (sensor.id === "engine_temp") return Number(data.value) > 105 ? "hot" : "stable";
  if (sensor.id === "oil_pressure") return Number(data.value) < 3 ? "low" : "nominal";
  return "live";
}

function getTrackPosition(progress, laneOffset = 0) {
  const angle = -Math.PI / 2 + progress * Math.PI * 2;
  const centerX = 500;
  const centerY = 310;
  const radiusX = 374;
  const radiusY = 198;
  const x = centerX + Math.cos(angle) * (radiusX + laneOffset);
  const y = centerY + Math.sin(angle) * (radiusY + laneOffset * 0.55);
  const dx = -Math.sin(angle) * radiusX;
  const dy = Math.cos(angle) * radiusY;

  return {
    x,
    y,
    rotation: (Math.atan2(dy, dx) * 180) / Math.PI,
  };
}

function StatusPill({ status }) {
  const labels = {
    connected: "Live",
    connecting: "Conectando",
    error: "Offline",
  };
  const colors = {
    connected: "bg-lime-300 shadow-lime-300/40",
    connecting: "bg-amber-300 shadow-amber-300/40",
    error: "bg-red-500 shadow-red-500/40",
  };

  return (
    <div className="flex items-center gap-2 rounded-sm border border-white/10 bg-black px-3 py-2 text-xs font-black uppercase tracking-[0.2em] text-white">
      <span className={`h-2 w-2 rounded-full shadow-lg ${colors[status]}`} />
      {labels[status]}
    </div>
  );
}

function RaceHeader({ car, cars, status, onCarChange }) {
  const teamStyle = { "--team-color": car.color ?? "#e10600" };

  return (
    <header className="border-b border-white/10 bg-black text-white" style={teamStyle}>
      <div className="flex flex-wrap items-stretch justify-between gap-3 px-4 py-3 md:px-6">
        <div className="flex min-w-0 items-center gap-4">
          <div className="grid h-12 w-12 place-items-center text-xl font-black" style={{ backgroundColor: "var(--team-color)" }}>
            {car.number}
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.35em]" style={{ color: "var(--team-color)" }}>
              Race Control
            </p>
            <h1 className="truncate text-2xl font-black uppercase tracking-tight md:text-3xl">{car.name}</h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onCarChange(null)}
            className="h-10 rounded-sm border border-white/10 bg-white/5 px-3 text-xs font-black uppercase tracking-[0.2em] text-white hover:bg-white/10"
          >
            Visao geral
          </button>
          <select
            value={car?.id ?? ""}
            onChange={(event) => onCarChange(Number(event.target.value))}
            className="h-10 rounded-sm border border-white/10 bg-zinc-950 px-3 text-sm font-bold uppercase text-white outline-none focus:border-[var(--team-color)]"
          >
            {cars.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <StatusPill status={status} />
        </div>
      </div>
    </header>
  );
}

function TabNav({ activeTab, onTabChange, alertCount, teamColor }) {
  const teamStyle = { "--team-color": teamColor ?? "#e10600" };

  return (
    <nav className="sticky top-0 z-20 border-b border-white/10 bg-zinc-950/95 px-4 py-2 backdrop-blur md:px-6" style={teamStyle}>
      <div className="flex gap-2 overflow-x-auto">
        {TAB_ITEMS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            className={`shrink-0 rounded-sm px-4 py-2 text-xs font-black uppercase tracking-[0.2em] transition ${
              activeTab === tab.id
                ? "text-white"
                : "bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white"
            }`}
            style={activeTab === tab.id ? { backgroundColor: "var(--team-color)" } : undefined}
          >
            {tab.label}
            {tab.id === "alerts" && alertCount > 0 && (
              <span className="ml-2 rounded-full bg-white px-2 py-0.5 text-[10px]" style={{ color: "var(--team-color)" }}>
                {alertCount}
              </span>
            )}
          </button>
        ))}
      </div>
    </nav>
  );
}

function OverviewHeader({ status }) {
  return (
    <header className="border-b border-white/10 bg-black px-4 py-4 text-white md:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.35em] text-red-500">Race Control</p>
          <h1 className="mt-1 text-3xl font-black uppercase tracking-tight md:text-4xl">Visao geral da corrida</h1>
          <p className="mt-1 text-sm text-zinc-500">Selecione uma equipe para abrir a telemetria detalhada.</p>
        </div>
        <StatusPill status={status} />
      </div>
    </header>
  );
}

function RaceTrackOverview({ cars, readingsByCar }) {
  const trackPath = "M 500 112 C 730 112 874 196 874 310 C 874 424 730 508 500 508 C 270 508 126 424 126 310 C 126 196 270 112 500 112 Z";
  const progressRef = useRef(Object.fromEntries(cars.map((car, index) => [car.id, index / cars.length])));
  const targetSpeedRef = useRef({});
  const currentSpeedRef = useRef({});
  const [carFrames, setCarFrames] = useState(() =>
    Object.fromEntries(cars.map((car, index) => [car.id, getTrackPosition(index / cars.length, (index - 1) * 18)])),
  );

  useEffect(() => {
    cars.forEach((car, index) => {
      if (progressRef.current[car.id] == null) {
        progressRef.current[car.id] = index / cars.length;
      }

      targetSpeedRef.current[car.id] = Number(readingsByCar[car.id]?.speed?.value) || 160;
    });
  }, [cars, readingsByCar]);

  useEffect(() => {
    let frameId;
    let lastTime = performance.now();

    function tick(now) {
      const deltaSeconds = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      const nextFrames = {};

      cars.forEach((car, index) => {
        const targetSpeed = targetSpeedRef.current[car.id] ?? 160;
        const currentSpeed = currentSpeedRef.current[car.id] ?? targetSpeed;
        const smoothedSpeed = currentSpeed + (targetSpeed - currentSpeed) * Math.min(1, deltaSeconds * 2.2);
        const lapDuration = Math.max(4.8, Math.min(13, 16 - smoothedSpeed / 28));
        const laneOffset = (index - 1) * 18;

        currentSpeedRef.current[car.id] = smoothedSpeed;
        progressRef.current[car.id] = ((progressRef.current[car.id] ?? index / cars.length) + deltaSeconds / lapDuration) % 1;
        nextFrames[car.id] = getTrackPosition(progressRef.current[car.id], laneOffset);
      });

      setCarFrames(nextFrames);
      frameId = requestAnimationFrame(tick);
    }

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [cars]);

  return (
    <section className="relative min-h-[520px] overflow-hidden border border-white/10 bg-[radial-gradient(circle_at_center,#18181b_0,#050505_64%,#000_100%)]">
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1000 620" role="img" aria-label="Mapa animado da corrida">
        <defs>
          <filter id="trackGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="7" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <rect x="0" y="0" width="1000" height="620" fill="transparent" />
        <path d={trackPath} fill="none" stroke="#27272a" strokeWidth="112" strokeLinecap="round" filter="url(#trackGlow)" />
        <path d={trackPath} fill="none" stroke="#3f3f46" strokeWidth="88" strokeLinecap="round" />
        <path d={trackPath} fill="none" stroke="#111113" strokeWidth="56" strokeLinecap="round" />
        <path d={trackPath} fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="2" strokeDasharray="12 18" />

        <g transform="translate(468 68)">
          <rect x="-2" y="-2" width="68" height="88" fill="#050505" opacity="0.9" />
          {Array.from({ length: 7 }).map((_, row) =>
            Array.from({ length: 4 }).map((__, col) => (
              <rect
                key={`${row}-${col}`}
                x={col * 16}
                y={row * 12}
                width="16"
                height="12"
                fill={(row + col) % 2 === 0 ? "#ffffff" : "#050505"}
              />
            )),
          )}
        </g>

        <text x="500" y="166" textAnchor="middle" fill="rgba(255,255,255,0.32)" fontSize="12" fontWeight="900" letterSpacing="6">
          START / FINISH
        </text>

        {cars.map((car, index) => {
          const speed = readingsByCar[car.id]?.speed?.value;
          const frame = carFrames[car.id] ?? getTrackPosition(index / cars.length, (index - 1) * 18);

          return (
            <g key={car.id}>
              <g transform={`translate(${frame.x} ${frame.y}) rotate(${frame.rotation})`}>
                <g transform="translate(-26 -15)">
                  <rect x="0" y="2" width="52" height="26" rx="8" fill={car.color} stroke="#fff" strokeWidth="3" />
                  <rect x="34" y="6" width="10" height="18" rx="3" fill="rgba(0,0,0,0.35)" />
                  <text x="21" y="21" textAnchor="middle" fill="#fff" fontSize="16" fontWeight="900">
                    {car.number}
                  </text>
                </g>
              </g>
              <text x={90} y={index * 24 + 560} fill={car.color} fontSize="12" fontWeight="900" letterSpacing="3">
                {car.name.toUpperCase()} {speed ? `${Number(speed).toFixed(0)} KM/H` : "AGUARDANDO"}
              </text>
            </g>
          );
        })}
      </svg>
    </section>
  );
}

function OverviewTeamCard({ car, readings, onSelectCar }) {
  const speedSensor = car.sensors.find((sensor) => sensor.id === "speed");
  const engineSensor = car.sensors.find((sensor) => sensor.id === "engine_temp");
  const fuelSensor = car.sensors.find((sensor) => sensor.id === "fuel_level");

  return (
    <button
      type="button"
      onClick={() => onSelectCar(car.id)}
      aria-label={`Abrir telemetria da ${car.name}`}
      className="group border border-white/10 bg-zinc-950 p-4 text-left transition hover:-translate-y-0.5 hover:border-white/30"
      style={{ "--team-color": car.color }}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">Equipe</p>
          <h2 className="mt-1 text-xl font-black uppercase text-white">{car.name}</h2>
        </div>
        <span className="grid h-11 w-11 place-items-center text-lg font-black text-white" style={{ backgroundColor: "var(--team-color)" }}>
          {car.number}
        </span>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2">
        <div>
          <p className="text-[10px] font-black uppercase text-zinc-500">Vel</p>
          <p className="text-lg font-black text-white">{formatShortValue(readings.speed, speedSensor)}</p>
        </div>
        <div>
          <p className="text-[10px] font-black uppercase text-zinc-500">Motor</p>
          <p className="text-lg font-black text-white">{formatShortValue(readings.engine_temp, engineSensor)}</p>
        </div>
        <div>
          <p className="text-[10px] font-black uppercase text-zinc-500">Fuel</p>
          <p className="text-lg font-black text-white">{formatShortValue(readings.fuel_level, fuelSensor)}</p>
        </div>
      </div>

      <p className="mt-4 text-xs font-black uppercase tracking-[0.2em] text-[var(--team-color)]">
        Abrir telemetria
      </p>
    </button>
  );
}

function RaceOverview({ cars, readingsByCar, onSelectCar }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
      <RaceTrackOverview cars={cars} readingsByCar={readingsByCar} />
      <aside className="space-y-3">
        {cars.map((car) => (
          <OverviewTeamCard
            key={car.id}
            car={car}
            readings={readingsByCar[car.id] ?? {}}
            onSelectCar={onSelectCar}
          />
        ))}
      </aside>
    </div>
  );
}

function RaceMetric({ sensor, data, alert }) {
  const active = isAlertActive(data?.value, alert);

  return (
    <article className={`border-l-4 bg-zinc-950 p-4 ${active ? "border-red-500" : "border-white/20"}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">{sensor.label}</p>
          <p className="mt-1 text-4xl font-black tracking-tight text-white">
            {formatShortValue(data, sensor)}
            <span className="ml-2 text-sm font-bold text-zinc-500">{sensor.unit}</span>
          </p>
        </div>
        <span className={`rounded-sm px-2 py-1 text-[10px] font-black uppercase ${active ? "bg-red-600 text-white" : "bg-white/10 text-zinc-400"}`}>
          {getTrendLabel(sensor, data)}
        </span>
      </div>
    </article>
  );
}

function RaceCarStage({ car, readings, alerts }) {
  const overlaySensors = car.sensors.filter((sensor) => KEY_SENSOR_IDS.includes(sensor.id));
  const teamStyle = { "--team-color": car.color ?? "#e10600" };

  return (
    <section
      className="relative min-h-[520px] overflow-hidden border border-white/10 bg-[radial-gradient(circle_at_center,#1f2937_0,#09090b_58%,#000_100%)]"
      style={teamStyle}
    >
      <div className="absolute left-0 top-0 h-full w-1" style={{ backgroundColor: "var(--team-color)" }} />
      <div className="absolute right-4 top-4 z-10 rounded-sm border border-white/10 bg-black px-4 py-3 text-right shadow-2xl">
        <p className="text-[10px] font-black uppercase tracking-[0.35em] text-zinc-500">Carro</p>
        <p className="text-5xl font-black leading-none" style={{ color: "var(--team-color)" }}>
          {car.number}
        </p>
      </div>

      <img
        src="/car.png"
        alt={`Carro da ${car.name}`}
        className="absolute inset-0 m-auto h-[82%] max-h-[700px] object-contain drop-shadow-[0_30px_60px_rgba(0,0,0,0.7)]"
      />

      {overlaySensors.map((sensor) => {
        const data = readings[sensor.id];
        const alert = alerts[sensor.id];
        const active = isAlertActive(data?.value, alert);

        return (
          <div
            key={sensor.id}
            className={`absolute min-w-32 -translate-x-1/2 -translate-y-1/2 rounded-sm border px-3 py-2 text-left backdrop-blur ${
              active ? "border-red-400 bg-red-600/90 text-white" : "border-white/10 bg-black/80 text-white"
            }`}
            style={{ left: `${sensor.position.x}%`, top: `${sensor.position.y}%` }}
          >
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">{sensor.label}</p>
            <p className="text-xl font-black">
              {formatShortValue(data, sensor)}
              <span className="ml-1 text-xs text-zinc-400">{sensor.unit}</span>
            </p>
          </div>
        );
      })}
    </section>
  );
}

function CompactTyreBoard({ car, readings, alerts }) {
  const tyreSensors = car.sensors.filter((sensor) => sensor.id.startsWith("tyre_"));

  return (
    <section className="border border-white/10 bg-zinc-950 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-black uppercase tracking-[0.25em] text-white">Pneus</h2>
        <p className="text-xs text-zinc-500">pressao + temperatura</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {tyreSensors.map((sensor) => {
          const data = readings[sensor.id];
          const active = isAlertActive(data?.value, alerts[sensor.id]);

          return (
            <div key={sensor.id} className={`rounded-sm border px-3 py-2 ${active ? "border-red-500 bg-red-950/70" : "border-white/10 bg-black/40"}`}>
              <p className="truncate text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">{sensor.label}</p>
              <p className="mt-1 text-lg font-black text-white">{formatValue(data, sensor)}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function AlertStrip({ activeAlerts, alerts }) {
  if (activeAlerts.length === 0) {
    return (
      <section className="border border-lime-300/30 bg-lime-300/10 px-4 py-3 text-sm font-bold uppercase tracking-[0.2em] text-lime-200">
        Sistema nominal. Nenhum alerta ativo.
      </section>
    );
  }

  return (
    <section className="border border-red-500 bg-red-700 text-white">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <span className="bg-white px-2 py-1 text-xs font-black uppercase text-red-700">Alerta</span>
        {activeAlerts.map((sensor) => (
          <span key={sensor.id} className="text-sm font-black uppercase tracking-wide">
            {alerts[sensor.id].message}: {sensor.label}
          </span>
        ))}
      </div>
    </section>
  );
}

function RaceView({ car, readings, alerts, activeAlerts }) {
  const keySensors = car.sensors.filter((sensor) => KEY_SENSOR_IDS.includes(sensor.id));

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <AlertStrip activeAlerts={activeAlerts} alerts={alerts} />
        <RaceCarStage car={car} readings={readings} alerts={alerts} />
      </div>

      <aside className="space-y-4">
        <div className="grid gap-3">
          {keySensors.map((sensor) => (
            <RaceMetric key={sensor.id} sensor={sensor} data={readings[sensor.id]} alert={alerts[sensor.id]} />
          ))}
        </div>
        <CompactTyreBoard car={car} readings={readings} alerts={alerts} />
      </aside>
    </div>
  );
}

function MetricChart({ sensor, history }) {
  const values = history.map((item) => item[sensor.id]).filter((value) => typeof value === "number");
  const latest = values.at(-1);
  const min = values.length > 0 ? Math.min(...values) : sensor.min;
  const max = values.length > 0 ? Math.max(...values) : sensor.max;
  const padding = Math.max((max - min) * 0.2, sensor.unit === "bar" ? 0.2 : 4);

  return (
    <section className="border border-white/10 bg-zinc-950 p-4">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">{sensor.label}</p>
          <p className="mt-1 text-3xl font-black text-white">
            {latest == null ? "--" : latest.toFixed(sensor.unit === "bar" ? 2 : 1)}
            <span className="ml-2 text-sm text-zinc-500">{sensor.unit}</span>
          </p>
        </div>
        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: CHART_COLORS[sensor.id] }} />
      </div>

      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={history}>
            <CartesianGrid stroke="#27272a" strokeDasharray="3 6" />
            <XAxis dataKey="time" tick={{ fill: "#a1a1aa", fontSize: 11 }} />
            <YAxis
              domain={[Math.max(sensor.min, min - padding), Math.min(sensor.max, max + padding)]}
              tick={{ fill: "#a1a1aa", fontSize: 11 }}
              width={42}
            />
            <Tooltip
              contentStyle={{
                background: "#050505",
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 2,
                color: "#fff",
              }}
            />
            <Line
              type="monotone"
              dataKey={sensor.id}
              name={sensor.label}
              stroke={CHART_COLORS[sensor.id]}
              dot={false}
              strokeWidth={2.5}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function TelemetryChart({ car, history }) {
  const sensors = car.sensors.filter((sensor) => CHART_SENSOR_IDS.includes(sensor.id));

  return (
    <section className="space-y-4">
      <div className="border border-white/10 bg-zinc-950 p-4">
        <h2 className="text-sm font-black uppercase tracking-[0.25em] text-white">Historico em tempo real</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Cada metrica usa sua propria escala para evitar distorcoes entre km/h, temperatura, porcentagem e bar.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {sensors.map((sensor) => (
          <MetricChart key={sensor.id} sensor={sensor} history={history} />
        ))}
      </div>
    </section>
  );
}

function SensorTable({ car, readings, alerts }) {
  const groups = [
    { title: "Power unit", match: (sensor) => ["engine_temp", "oil_pressure", "fuel_level", "speed"].includes(sensor.id) },
    { title: "Pneus", match: (sensor) => sensor.id.startsWith("tyre_") },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {groups.map((group) => (
        <section key={group.title} className="border border-white/10 bg-zinc-950">
          <h2 className="border-b border-white/10 px-4 py-3 text-sm font-black uppercase tracking-[0.25em] text-white">
            {group.title}
          </h2>
          <div className="divide-y divide-white/10">
            {car.sensors.filter(group.match).map((sensor) => {
              const data = readings[sensor.id];
              const active = isAlertActive(data?.value, alerts[sensor.id]);

              return (
                <div key={sensor.id} className="grid grid-cols-[1fr_auto] gap-3 px-4 py-3">
                  <div>
                    <p className="text-sm font-bold text-white">{sensor.label}</p>
                    <p className="text-xs text-zinc-500">{sensor.topic}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-black text-white">{formatValue(data, sensor)}</p>
                    {alerts[sensor.id] && (
                      <p className={active ? "text-xs font-bold text-red-400" : "text-xs text-zinc-500"}>
                        {alerts[sensor.id].operator} {alerts[sensor.id].threshold} {sensor.unit}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function TelemetryView({ car, readings, alerts, history }) {
  return (
    <div className="space-y-4">
      <TelemetryChart car={car} history={history} />
      <SensorTable car={car} readings={readings} alerts={alerts} />
    </div>
  );
}

function AlertsView({ car, readings, alerts, activeAlerts }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
      <section className="border border-white/10 bg-zinc-950">
        <h2 className="border-b border-white/10 px-4 py-3 text-sm font-black uppercase tracking-[0.25em] text-white">
          Alertas ativos
        </h2>
        <div className="space-y-3 p-4">
          {activeAlerts.length === 0 ? (
            <p className="rounded-sm border border-lime-300/30 bg-lime-300/10 p-4 text-sm font-bold text-lime-200">
              Nenhum alerta ativo no momento.
            </p>
          ) : (
            activeAlerts.map((sensor) => (
              <article key={sensor.id} className="border-l-4 border-red-500 bg-red-950/60 p-4">
                <p className="text-sm font-black uppercase text-white">{alerts[sensor.id].message}</p>
                <p className="mt-1 text-xs text-red-100">
                  {sensor.label}: {formatValue(readings[sensor.id], sensor)}
                </p>
              </article>
            ))
          )}
        </div>
      </section>

      <AlertSettings car={car} alerts={alerts} onChange={() => {}} readonly />
    </div>
  );
}

function AlertSettings({ car, alerts, onChange, readonly = false }) {
  const teamStyle = { "--team-color": car.color ?? "#e10600" };

  return (
    <aside className="border border-white/10 bg-zinc-950 p-4" style={teamStyle}>
      <h2 className="text-sm font-black uppercase tracking-[0.25em] text-white">Limites</h2>
      <div className="mt-4 space-y-3">
        {car.sensors
          .filter((sensor) => sensor.alert)
          .map((sensor) => (
            <label key={sensor.id} className="block">
              <span className="text-xs font-bold uppercase text-zinc-500">{sensor.label}</span>
              <div className="mt-1 grid grid-cols-[24px_1fr_44px] items-center gap-2">
                <span className="text-sm font-black" style={{ color: "var(--team-color)" }}>
                  {sensor.alert.operator}
                </span>
                <input
                  type="number"
                  step={sensor.unit === "bar" ? "0.1" : "1"}
                  value={alerts[sensor.id]?.threshold ?? sensor.alert.threshold}
                  readOnly={readonly}
                  onChange={(event) => onChange(sensor.id, Number(event.target.value))}
                  className="w-full rounded-sm border border-white/10 bg-black px-3 py-2 text-sm font-bold text-white outline-none focus:border-[var(--team-color)] disabled:opacity-70"
                />
                <span className="text-sm text-zinc-500">{sensor.unit}</span>
              </div>
            </label>
          ))}
      </div>
    </aside>
  );
}

function SetupView({ car, alerts, onAlertChange }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
      <AlertSettings car={car} alerts={alerts} onChange={onAlertChange} />
      <section className="border border-white/10 bg-zinc-950 p-4">
        <h2 className="text-sm font-black uppercase tracking-[0.25em] text-white">Operacao</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="bg-black p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Topicos ativos</p>
            <p className="mt-2 text-4xl font-black text-white">{car.sensors.length}</p>
          </div>
          <div className="bg-black p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Persistencia</p>
            <p className="mt-2 text-lg font-black uppercase text-white">LocalStorage</p>
          </div>
        </div>
        <p className="mt-4 text-sm leading-6 text-zinc-400">
          Esta area concentra configuracoes para nao poluir a tela de corrida. Durante a prova, o operador ve so o
          essencial e entra aqui apenas para ajustar limites.
        </p>
      </section>
    </div>
  );
}

export default function App() {
  const [config, setConfig] = useState(null);
  const [selectedCarId, setSelectedCarId] = useState(getInitialCarId);
  const [readingsByCar, setReadingsByCar] = useState({});
  const [historyByCar, setHistoryByCar] = useState({});
  const [alertOverrides, setAlertOverrides] = useState({});
  const [status, setStatus] = useState("connecting");
  const [activeTab, setActiveTab] = useState("race");

  useEffect(() => {
    fetch(CONFIG_URL)
      .then((response) => response.json())
      .then(setConfig)
      .catch(() => setStatus("error"));
  }, []);

  const car = useMemo(
    () => config?.cars.find((item) => item.id === selectedCarId) ?? null,
    [config, selectedCarId],
  );

  const readings = readingsByCar[car?.id] ?? {};
  const history = historyByCar[car?.id] ?? [];

  const alerts = useMemo(() => {
    if (!car) return {};

    const savedLimits = {
      ...loadSavedLimits(car),
      ...(alertOverrides[car.id] ?? {}),
    };

    return Object.fromEntries(
      car.sensors
        .filter((sensor) => sensor.alert)
        .map((sensor) => [
          sensor.id,
          {
            ...sensor.alert,
            threshold: savedLimits[sensor.id] ?? sensor.alert.threshold,
          },
        ]),
    );
  }, [alertOverrides, car]);

  useEffect(() => {
    if (!config) return;
    window.history.replaceState(null, "", car ? `?carId=${car.id}` : window.location.pathname);
  }, [car, config]);

  useEffect(() => {
    if (!config) return;

    const client = mqtt.connect(BROKER_URL);
    const subscribedCars = car ? [car] : config.cars;

    client.on("connect", () => {
      setStatus("connected");
      subscribedCars.forEach((item) => item.sensors.forEach((sensor) => client.subscribe(sensor.topic)));
    });

    client.on("message", (_, message) => {
      const parsed = JSON.parse(message.toString());
      if (!subscribedCars.some((item) => item.id === parsed.carId)) return;

      setReadingsByCar((current) => ({
        ...current,
        [parsed.carId]: {
          ...(current[parsed.carId] ?? {}),
          [parsed.sensorId]: parsed,
        },
      }));

      if (CHART_SENSOR_IDS.includes(parsed.sensorId)) {
        setHistoryByCar((current) => {
          const previousHistory = current[parsed.carId] ?? [];
          const previousPoint = previousHistory.at(-1) ?? {};
          const nextPoint = {
            ...previousPoint,
            time: new Date(parsed.timestamp).toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            }),
            [parsed.sensorId]: parsed.value,
          };

          return {
            ...current,
            [parsed.carId]: [...previousHistory.slice(-59), nextPoint],
          };
        });
      }
    });

    client.on("error", () => setStatus("error"));

    return () => client.end();
  }, [car, config]);

  function updateAlert(sensorId, threshold) {
    if (!car) return;
    const nextOverrides = {
      ...(alertOverrides[car.id] ?? {}),
      [sensorId]: threshold,
    };

    setAlertOverrides((current) => ({
      ...current,
      [car.id]: nextOverrides,
    }));
    localStorage.setItem(`racetrack-alerts-${car.id}`, JSON.stringify(nextOverrides));
  }

  function handleCarChange(carId) {
    setStatus("connecting");
    setActiveTab("race");
    setSelectedCarId(carId);
  }

  if (!config) {
    return <main className="grid min-h-screen place-items-center bg-black text-white">Carregando telemetria...</main>;
  }

  if (!car) {
    return (
      <main className="min-h-screen bg-black text-zinc-100">
        <OverviewHeader status={status} />
        <div className="p-4 md:p-6">
          <RaceOverview cars={config.cars} readingsByCar={readingsByCar} onSelectCar={handleCarChange} />
        </div>
      </main>
    );
  }

  const activeAlerts = car.sensors.filter((sensor) => isAlertActive(getSensorValue(readings, sensor.id), alerts[sensor.id]));

  return (
    <main className="min-h-screen bg-black text-zinc-100">
      <RaceHeader car={car} cars={config.cars} status={status} onCarChange={handleCarChange} />
      <TabNav
        activeTab={activeTab}
        onTabChange={setActiveTab}
        alertCount={activeAlerts.length}
        teamColor={car.color}
      />

      <div className="p-4 md:p-6">
        {activeTab === "race" && <RaceView car={car} readings={readings} alerts={alerts} activeAlerts={activeAlerts} />}
        {activeTab === "telemetry" && <TelemetryView car={car} readings={readings} alerts={alerts} history={history} />}
        {activeTab === "alerts" && <AlertsView car={car} readings={readings} alerts={alerts} activeAlerts={activeAlerts} />}
        {activeTab === "setup" && <SetupView car={car} alerts={alerts} onAlertChange={updateAlert} />}
      </div>
    </main>
  );
}
