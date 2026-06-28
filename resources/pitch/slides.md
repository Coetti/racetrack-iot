# RaceTrack IoT — Guia de Montagem dos Slides

---

## SLIDE 1 — Capa

**Layout:** Centralizado, fundo escuro com imagem do carro

**Título:**

> RaceTrack IoT

**Subtítulo:**

> Simulação de Telemetria Automotiva em Tempo Real com MQTT

**Rodapé:**

> Disciplina de Internet das Coisas · [Nome do grupo] · [Semestre/Ano]

**Visual:**

![Background gerado para o projeto](https://imgur.com/1ifvaaH.png)

---

## SLIDE 2 — Motivação / Problema

**Título do slide:** Por que simular um carro de corrida?

**Texto introdutório:**

> Demonstrar conceitos de IoT com hardware físico é caro, complexo e difícil de escalar. Precisávamos de um contexto realista, dinâmico e visualmente interessante para aplicar os fundamentos de dispositivos conectados, transmissão contínua de dados e monitoramento em tempo real.

**Bullets:**

- 🚫 Sensores físicos são caros e limitados ao ambiente de laboratório
- 🚫 Exemplos comuns (temperatura de sala, LEDs) são pouco atrativos e didaticamente rasos
- 🚫 Simulações simples não capturam a complexidade real de um ambiente IoT
- ✅ Um carro de corrida possui múltiplos sensores interdependentes, dados em alta frequência e criticidade real nas leituras

---

## SLIDE 3 — Solução Proposta

**Título do slide:** A solução: telemetria de corrida como ambiente IoT

**Texto introdutório:**

> Simular três carros de corrida como dispositivos IoT independentes, cada um transmitindo dados de sensores em tempo real via MQTT para um dashboard web de monitoramento.

**Bullets:**

- 🏎️ **3 carros** = 3 dispositivos IoT rodando em paralelo
- 📡 **MQTT** como protocolo de comunicação pub/sub
- 🧵 **Uma thread por sensor** — publicação simultânea e independente
- ⚙️ **Sensores definidos via `sensors.json`** — configuração centralizada
- 🖥️ **Dashboard React** com múltiplas telas de visualização e sistema de alertas

---

## SLIDE 4 — Arquitetura Geral do Sistema

**Título do slide:** Arquitetura do Sistema

\*\*Visual principal:

![Diagrama de Arquitetura](https://imgur.com/HpBN7Jr.png)\*\*

**Legenda abaixo do diagrama:**

> **Simulador Python** publica nos tópicos MQTT → **Broker Mosquitto** (Docker) roteia as mensagens → **Dashboard React** consome via WebSocket e exibe em tempo real

**Nota de rodapé do slide:**

> Porta 1883 (MQTT padrão) · Porta 9001 (WebSocket para o frontend)

---

## SLIDE 5 — Configuração Centralizada: `sensors.json`

**Título do slide:** `sensors.json` — O contrato do sistema

**Texto:**

> Todos os carros e seus sensores são definidos em um único arquivo JSON. Ele é a fonte de verdade compartilhada entre o simulador e o frontend: define quais sensores existem, suas características físicas, o tópico MQTT onde publicam, a frequência de envio e as condições de alerta.

**Tabela de campos:**

| Campo          | Descrição                          |
| -------------- | ---------------------------------- |
| `id`           | Identificador único do sensor      |
| `topic`        | Tópico MQTT de publicação          |
| `frequency_ms` | Intervalo de publicação em ms      |
| `simulation`   | Modelo matemático utilizado        |
| `alert`        | Condição e mensagem de alerta      |
| `position`     | Posição visual no dashboard (x, y) |

> sensors.json
>
> ![Sensors no JSON](https://imgur.com/nNMqLWW.png)

---

## SLIDE 6 — Simulador Python: Visão Geral da Concorrência

**Título do slide:** Simulador Python — Múltiplos dispositivos em paralelo

**Texto:**

> O simulador representa fielmente a natureza distribuída de um ambiente IoT: cada carro possui sua própria thread principal, que por sua vez instancia uma thread dedicada para cada sensor. Todas as threads publicam simultaneamente nos seus respectivos tópicos MQTT, de forma totalmente independente.

**Diagrama textual (incluir no slide como visual simples):**

![Arquitetura das Threads](https://imgur.com/nI2tfUe.png)

**Bloco de código:**

![Função que Inicia as Threads](https://imgur.com/32aue3f.png)

**Terminal com as threads publicando nos tópicos.**

---

## SLIDE 7 — Motor de Física: `CarPhysics`

**Título do slide:** Motor de Física — Sensores interconectados

**Texto:**

> Velocidade, RPM, marcha, acelerador e freio são métricas interdependentes — não faz sentido simulá-las de forma isolada. A classe `CarPhysics` resolve isso: ela modela a dinâmica do carro em uma thread separada, e todos os sensores do grupo `physics` leem seu snapshot a cada publicação.

**Bullets:**

- A pista é dividida em **segmentos** (reta, zona de frenagem, curva, aceleração)
- Cada segmento define os **targets de throttle, brake e velocidade**
- A velocidade converge suavemente para o target (lag de 1ª ordem)
- Marcha e RPM são **derivados da velocidade** — nunca calculados de forma independente
- Um lock garante **consistência dos dados** entre a thread de física e as threads de sensores

**Tabela de segmentos:**

| Segmento     | Throttle | Brake  | Comportamento        |
| ------------ | -------- | ------ | -------------------- |
| `straight`   | ~92%     | 0%     | Aceleração máxima    |
| `brake_zone` | ~0–5%    | 20–98% | Frenagem progressiva |
| `corner`     | 22–47%   | 0–10%  | Curva controlada     |
| `accel`      | 60–95%   | 0%     | Saída de curva       |

**Bloco de código:**

```python
if seg_type == "brake_zone":
    throttle = clamp(0.05 * (1.0 - local_p), 0.0, 1.0)
    brake    = clamp(0.2 + local_p * 0.78 + random.uniform(-0.05, 0.05), 0.0, 1.0)
```

> Print do código da classe `CarPhysics`, com destaque no método `update()` e na lista `_RAW_TRACK`
> ![CarPhysics](https://imgur.com/TpA2UWU.png)
> Função Update
> ![Update Function](https://imgur.com/mXqv2HC.png)

---

## SLIDE 8 — Modelos de Simulação dos Sensores

**Título do slide:** Modelos matemáticos de simulação

**Texto:**

> Sensores que não fazem parte do motor de física usam funções matemáticas próprias que aproximam o comportamento real de cada grandeza durante uma corrida.

**Tabela:**

| Sensor                    | Modelo         | Comportamento simulado                                 |
| ------------------------- | -------------- | ------------------------------------------------------ |
| Velocidade / RPM / Marcha | `physics`      | Calculados pelo motor de física acoplado               |
| Temperatura do motor      | `ramp`         | Sobe gradualmente até estabilizar na faixa operacional |
| Temperatura dos pneus     | `ramp_noise`   | Aquecimento progressivo com variação por carga         |
| Pressão dos pneus / Óleo  | `stable_noise` | Valor estável com pequenas oscilações e drift          |
| Nível de combustível      | `fuel_burn`    | Decresce continuamente; reseta ao atingir mínimo       |

**Bloco de código (exemplo fuel_burn):**

> Funções de Simulação
> ![Funcoes de Simulacao](https://imgur.com/3708l74.png)

---

## SLIDE 9 — Broker MQTT (Mosquitto + Docker)

**Título do slide:** Broker MQTT — Mosquitto via Docker

**Texto:**

> O broker é o hub de comunicação do sistema. Ele recebe todas as publicações do simulador e as distribui para qualquer cliente inscrito nos tópicos correspondentes. Roda inteiramente em Docker, sem instalação local.

**Estrutura de tópicos:**

```
car/{carId}/{sensorId}

Exemplos:
  car/1/speed
  car/1/engine_temp
  car/2/tyre_pressure_fl
  car/3/brake_temp_rr
  car/3/fuel_level
```

**Schema do payload:**

```json
{
  "carId": 1,
  "carName": "Equipe Azul",
  "sensorId": "engine_temp",
  "label": "Temperatura do motor",
  "value": 96.4,
  "unit": "C",
  "timestamp": "2024-06-01T15:30:00.000Z"
}
```

**Bullets:**

- Porta `1883` → simulador Python (`paho-mqtt`)
- Porta `9001` → frontend React (`MQTT.js` via WebSocket)
- Tópicos hierárquicos garantem **desacoplamento total** entre produtor e consumidor

> Print do `docker-compose.yml`
> ![docker-compose](https://imgur.com/CDCyy0P.png)

---

## SLIDE 10 — Frontend React: Estrutura de Telas

**Título do slide:** Dashboard Web — Estrutura de navegação

**Texto:**

> O dashboard foi desenvolvido em React e organizado em telas especializadas, acessíveis por carro. A navegação permite alternar entre visões de alto nível da corrida e análises detalhadas por carro.

**Diagrama de navegação (incluir como visual):**

```
Dashboard
 ├── 🏁 Race Overview    — Visão geral dos 3 carros (métricas principais)
 ├── 🚗 Race View (por carro)
 │    ├── Foto aérea do carro com sensores sobrepostos (position x,y)
 │    ├── Displays e gauges dos sensores
 │    ├── Gráficos de telemetria ao vivo
 │    └── Alertas ativos do carro
 ├── 📈 Telemetry View   — Gráficos históricos detalhados por métrica
 ├── 🔔 Alerts View      — Todos os alertas ativos e histórico
 └── ⚙️  Setup View       — Configuração dos thresholds de alerta por sensor
```

---

## SLIDE 11 — Race View: Visualização por Carro

**Título do slide:** Race View — Telemetria visual do carro

**Texto:**

> A Race View é a tela principal de acompanhamento de um carro. A imagem aérea do carro serve de base, e cada sensor é posicionado sobre ela usando coordenadas `x, y` definidas no `sensors.json`, alinhando visualmente cada leitura ao componente físico correspondente.

**Bullets:**

- Sensores de **pneus** aparecem sobre cada rodado da imagem
- **Temperatura do motor** posicionada sobre o bloco do carro
- **Combustível** no painel traseiro
- Valores críticos exibem destaque visual de alerta em tempo real

**Visuais de referência:**

> [🖼️ IMAGEM — https://imgur.com/YTh1t8s.png]
> [🖼️ IMAGEM — https://imgur.com/CidcUpa.png]
> ![Exemplo Dashboard 1](https://imgur.com/WKU7fnB.png)
> ![Exemplo de Dashboard 2](https://imgur.com/Fx4C9MQ.png)

> Print da nossa tela de RaceView
> ![RaceView Desenvolvida](https://imgur.com/F4gz1SH.png)

---

## SLIDE 12 — Telemetry View: Histórico de Métricas

**Título do slide:** Telemetry View — Análise histórica da telemetria

**Texto:**

> A Telemetry View exibe gráficos detalhados de cada sensor ao longo do tempo, permitindo analisar o comportamento do carro durante a corrida. É possível visualizar padrões como aquecimento de pneus, variação de RPM por segmento de pista e consumo de combustível.

**Bullets:**

- Gráficos de linha com histórico acumulado por sessão
- Seleção individual de métricas para análise
- Permite identificar anomalias e tendências ao longo das voltas

---

## SLIDE 13 — Alerts View e Setup View

**Título do slide:** Alertas e Configuração — Monitoramento inteligente

**Layout sugerido:** Dois blocos lado a lado

**Bloco esquerdo — Alerts View:**

> Exibe todos os alertas ativos de um carro em tempo real. Cada alerta mostra o sensor, o valor atual, o threshold configurado e a mensagem definida no `sensors.json`.

**Exemplos de alertas:**

- 🔴 `engine_temp > 112°C` → _"Risco de superaquecimento"_
- 🔴 `fuel_level < 18%` → _"Programar pit stop para abastecimento"_
- 🔴 `tyre_pressure_fl < 1.7 bar` → _"Possível pneu furado"_

**Bloco direito — Setup View:**

> Permite ao usuário ajustar os thresholds de alerta de cada sensor individualmente, sem alterar o código. Configurações são persistidas via `localStorage`.

---

## SLIDE 14 — Conexão MQTT no Frontend

**Título do slide:** Frontend — Conexão MQTT em tempo real

**Texto:**

> O React se conecta ao broker via MQTT.js (WebSocket na porta 9001). Ao carregar o dashboard de um carro, o frontend lê os sensores daquele carro e se inscreve automaticamente nos tópicos correspondentes. Cada mensagem recebida atualiza o estado do componente em tempo real.

**Bullets:**

- Sem polling — atualização **orientada a eventos**
- Sem backend intermediário — o browser consome MQTT diretamente
- Inscrição automática baseada nos tópicos do `sensors.json`

---

## SLIDE 15 — Sensores Implementados

**Título do slide:** Sensores implementados por carro

**Texto:**

> Cada carro possui 15 sensores ativos, cobrindo as principais grandezas de telemetria de um carro de corrida real.

**Tabela:**

| Sensor            | ID                | Unidade | Frequência | Modelo       |
| ----------------- | ----------------- | ------- | ---------- | ------------ |
| Velocidade        | `speed`           | km/h    | 100ms      | physics      |
| RPM               | `rpm`             | rpm     | 100ms      | physics      |
| Marcha            | `gear`            | —       | 100ms      | physics      |
| Acelerador        | `throttle`        | %       | 100ms      | physics      |
| Freio             | `brake`           | %       | 100ms      | physics      |
| Temp. motor       | `engine_temp`     | °C      | 1000ms     | ramp         |
| Combustível       | `fuel_level`      | %       | 1500ms     | fuel_burn    |
| Pressão pneu (x4) | `tyre_pressure_*` | bar     | 1000ms     | stable_noise |
| Temp. pneu (x4)   | `tyre_temp_*`     | °C      | 1000ms     | ramp_noise   |
| Pressão de óleo   | `oil_pressure`    | bar     | 1000ms     | stable_noise |

---

## SLIDE 16 — Conclusão e Resultados

**Título do slide:** Resultados alcançados

**Texto:**

> O projeto atingiu os objetivos propostos, entregando uma simulação completa de ambiente IoT aplicada a um contexto automotivo real e visualmente rico.

**Bullets:**

- ✅ Simulação realista com motor de física acoplando 5 métricas interdependentes
- ✅ Concorrência real — múltiplos carros e sensores publicando simultaneamente
- ✅ Protocolo MQTT implementado de ponta a ponta (Python → Mosquitto → React)
- ✅ Dashboard com 5 telas distintas de visualização e monitoramento
- ✅ Sistema de alertas configurável por sensor sem alterar código
- ✅ Persistência de configurações via `localStorage`
- ✅ Projeto containerizado com Docker (broker Mosquitto)

---

## SLIDE 17 — Aprendizados e Conclusão

**Título do slide:** O que aprendemos

**Bullets:**

- 📡 MQTT como protocolo pub/sub leve e eficiente para IoT
- 🧵 Uso de threads para modelar dispositivos IoT concorrentes
- 🌐 Comunicação full-stack sem backend intermediário via WebSocket + MQTT.js
- 🏎️ Modelagem de sistemas físicos com estado compartilhado entre threads

---

_Fim do guia — total estimado: 17 slides_
