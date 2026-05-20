# RaceTrack IoT — Architecture Document

## Visão Geral

O **RaceTrack IoT** é uma simulação de telemetria automotiva em tempo real baseada em conceitos de IoT. Três carros de corrida são representados como dispositivos IoT que geram e transmitem dados de sensores continuamente via protocolo MQTT. Um dashboard web por carro exibe os dados em tempo real, com os valores posicionados sobre a imagem do carro de forma que cada leitura esteja visualmente alinhada ao componente correspondente.

O diferencial do projeto está na abordagem orientada por configuração: os sensores de cada carro são definidos em um arquivo `sensors.json`, permitindo adicionar ou remover sensores sem alterar o código.

---

## Arquitetura do Sistema

![Architecture](https://imgur.com/HpBN7Jr.png)

---

## Simulador (Python)

### Visão geral

O simulador é o coração do backend. Ele é responsável por instanciar os carros, inicializar os sensores e publicar os dados no broker MQTT.

### `main.py` — Orquestrador

O `main.py` lê o `sensors.json` e inicia um **worker concorrente por carro** utilizando `multiprocessing` ou `threading`. Cada worker representa um carro na simulação e é responsável por gerenciar os sensores daquele carro de forma independente.

```python
# Fluxo simplificado do main.py
for car in cars:
    Process(target=run_car, args=(car,)).start()
```

### Workers por carro

Cada worker de carro lê os sensores configurados para aquele carro e inicia uma **thread por sensor**. Cada thread publica no seu próprio ritmo, respeitando a frequência definida no `sensors.json`.

```python
# Fluxo simplificado do worker de carro
for sensor in car.sensors:
    Thread(target=sensor.run, args=(mqtt_client,)).start()
```

### Funções de simulação

Os valores dos sensores são gerados por funções matemáticas que aproximam o comportamento real:

| Sensor                 | Modelo                        | Descrição                                              |
| ---------------------- | ----------------------------- | ------------------------------------------------------ |
| Velocidade             | Senoidal com offset           | Simula retas (aceleração) e curvas (desaceleração)     |
| Temperatura do motor   | Rampa logarítmica             | Sobe gradualmente até estabilizar em faixa operacional |
| Temperatura dos pneus  | Rampa com ruído               | Aquecimento progressivo com pequenas variações         |
| Pressão dos pneus      | Valor estável com ruído       | Varia levemente em torno de um valor base              |
| Temperatura dos freios | Pico + decaimento exponencial | Sobe em frenagens e resfria nas retas                  |

### Biblioteca

- **`paho-mqtt`** para publicação no broker

---

## Broker MQTT (Mosquitto)

### Configuração

O broker roda via **Docker** com suporte a:

- Conexões MQTT padrão na porta `1883`
- Conexões via **WebSocket na porta `9001`** (necessário para o frontend via MQTT.js)

### Estrutura de tópicos

```
car/{carId}/{sensorId}
```

**Exemplos:**

```
car/1/speed
car/1/engine_temp
car/2/tyre_temp_fl
car/3/brake_temp_rr
car/3/tyre_pressure_fl
```

### Schema do payload

Cada mensagem publicada segue o seguinte formato JSON:

```json
{
  "carId": 1,
  "sensorId": "tyre_temp_fl",
  "value": 87.4,
  "unit": "°C",
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

---

## Schema do `sensors.json`

O arquivo `sensors.json` é o contrato central do projeto. Ele define quais sensores existem, suas características e comportamento de simulação.

```json
{
  "cars": [
    {
      "id": 1,
      "name": "Car 01",
      "sensors": [
        {
          "id": "speed",
          "type": "speed",
          "unit": "km/h",
          "topic": "car/1/speed",
          "frequency_ms": 200,
          "min": 80,
          "max": 320,
          "simulation": "sinusoidal"
        },
        {
          "id": "engine_temp",
          "type": "temperature",
          "unit": "°C",
          "topic": "car/1/engine_temp",
          "frequency_ms": 1000,
          "min": 80,
          "max": 130,
          "simulation": "ramp"
        },
        {
          "id": "tyre_temp_fl",
          "type": "temperature",
          "unit": "°C",
          "topic": "car/1/tyre_temp_fl",
          "frequency_ms": 1000,
          "min": 60,
          "max": 110,
          "simulation": "ramp_noise"
        }
      ]
    }
  ]
}
```

**Campos:**

| Campo          | Tipo   | Descrição                                                      |
| -------------- | ------ | -------------------------------------------------------------- |
| `id`           | string | Identificador único do sensor                                  |
| `type`         | string | Tipo do sensor (speed, temperature, pressure)                  |
| `unit`         | string | Unidade de medida                                              |
| `topic`        | string | Tópico MQTT onde o sensor publica                              |
| `frequency_ms` | int    | Intervalo de publicação em milissegundos                       |
| `min`          | float  | Valor mínimo simulado                                          |
| `max`          | float  | Valor máximo simulado                                          |
| `simulation`   | string | Modelo de simulação (sinusoidal, ramp, ramp_noise, peak_decay) |

---

## Frontend (React)

### Roteamento

Cada carro possui seu próprio dashboard acessível via:

```
http://localhost/dashboard?carId=1
http://localhost/dashboard?carId=2
http://localhost/dashboard?carId=3
```

O `carId` é usado para filtrar os sensores do `sensors.json` e para montar os tópicos MQTT nos quais o dashboard irá se inscrever.

### Carregamento dinâmico de sensores

Ao acessar o dashboard, o frontend:

1. Lê o `sensors.json`
2. Filtra os sensores do `carId` correspondente
3. Renderiza os componentes de cada sensor dinamicamente
4. Se inscreve automaticamente nos tópicos MQTT de cada sensor

### Conexão MQTT

O frontend utiliza **MQTT.js** conectando via WebSocket na porta `9001` do broker:

```js
const client = mqtt.connect("ws://localhost:9001");

sensors.forEach((sensor) => {
  client.subscribe(sensor.topic);
});

client.on("message", (topic, message) => {
  const data = JSON.parse(message.toString());
  // atualiza estado do sensor correspondente
});
```

### Layout do dashboard

O dashboard é composto por uma **imagem estática do carro** (vista aérea, estilo GT) com os dados dos sensores posicionados via **CSS `position: absolute`**, alinhados visualmente ao componente do carro correspondente (ex: temperatura do pneu dianteiro esquerdo posicionada sobre o pneu dianteiro esquerdo na imagem).

### Gerenciamento de estado

- **localStorage** para persistir configurações de cada componente do dashboard (ex: limites de alerta, preferências de visualização)

### Referências visuais do dashboard

#### **Exemplo 1**

![Example2](https://imgur.com/YTh1t8s.png)

#### **Exemplo 2**

![Example2](https://imgur.com/CidcUpa.png)

#### **Background Gerado na IA para nosso projeto**

![DashboardBackground](https://imgur.com/qQRqWzi.png)

---

## Sensores implementados

| Sensor                           | ID                 | Unidade | Frequência | Tópico                      |
| -------------------------------- | ------------------ | ------- | ---------- | --------------------------- |
| Velocidade                       | `speed`            | km/h    | 200ms      | `car/{id}/speed`            |
| Temperatura do motor             | `engine_temp`      | °C      | 1000ms     | `car/{id}/engine_temp`      |
| Temperatura pneu dianteiro esq.  | `tyre_temp_fl`     | °C      | 1000ms     | `car/{id}/tyre_temp_fl`     |
| Temperatura pneu dianteiro dir.  | `tyre_temp_fr`     | °C      | 1000ms     | `car/{id}/tyre_temp_fr`     |
| Temperatura pneu traseiro esq.   | `tyre_temp_rl`     | °C      | 1000ms     | `car/{id}/tyre_temp_rl`     |
| Temperatura pneu traseiro dir.   | `tyre_temp_rr`     | °C      | 1000ms     | `car/{id}/tyre_temp_rr`     |
| Pressão pneu dianteiro esq.      | `tyre_pressure_fl` | bar     | 1000ms     | `car/{id}/tyre_pressure_fl` |
| Pressão pneu dianteiro dir.      | `tyre_pressure_fr` | bar     | 1000ms     | `car/{id}/tyre_pressure_fr` |
| Pressão pneu traseiro esq.       | `tyre_pressure_rl` | bar     | 1000ms     | `car/{id}/tyre_pressure_rl` |
| Pressão pneu traseiro dir.       | `tyre_pressure_rr` | bar     | 1000ms     | `car/{id}/tyre_pressure_rr` |
| Temperatura freio dianteiro esq. | `brake_temp_fl`    | °C      | 500ms      | `car/{id}/brake_temp_fl`    |
| Temperatura freio dianteiro dir. | `brake_temp_fr`    | °C      | 500ms      | `car/{id}/brake_temp_fr`    |
| Temperatura freio traseiro esq.  | `brake_temp_rl`    | °C      | 500ms      | `car/{id}/brake_temp_rl`    |
| Temperatura freio traseiro dir.  | `brake_temp_rr`    | °C      | 500ms      | `car/{id}/brake_temp_rr`    |
