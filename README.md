# RaceTrack IoT

Simulacao de telemetria automotiva em tempo real para carros de corrida, usando MQTT, Python e React.

## O que o projeto implementa

- Broker MQTT com Eclipse Mosquitto via Docker.
- Publicacao MQTT comum na porta `1883`.
- Publicacao via WebSocket na porta `9001` para o dashboard web.
- Simulador Python com multiplos carros/equipes.
- Sensores sinteticos de velocidade, temperatura do motor, combustivel, pressao dos pneus, temperatura dos pneus e pressao de oleo.
- Topicos MQTT separados por carro no formato `car/{carId}/{sensorId}`.
- Dashboard React com selecao de equipe/carro.
- Assinatura dinamica dos topicos do carro selecionado.
- Visualizacao em tempo real sobre a imagem do carro.
- Grafico historico das principais metricas.
- Painel de limites configuraveis por equipe, salvo em `localStorage`.
- Alertas automaticos para superaquecimento, baixo combustivel, baixa pressao dos pneus, pneu superaquecido e baixa pressao de oleo.

## Como rodar

1. Suba o broker MQTT:

```bash
docker compose up -d
```

2. Instale as dependencias do simulador:

```bash
cd simulator
pip install -r requirements.txt
```

3. Rode o simulador:

```bash
python main.py
```

4. Em outro terminal, rode o dashboard:

```bash
cd dashboard
npm install
npm run dev
```

5. Acesse o dashboard:

```text
http://localhost:5173/?carId=1
http://localhost:5173/?carId=2
http://localhost:5173/?carId=3
```

## Observacao

Se o dashboard mostrar `--` em alguns sensores, reinicie o simulador e atualize a pagina. Isso geralmente indica que o frontend carregou a configuracao nova, mas ainda esta recebendo mensagens de uma execucao antiga do simulador.
