### 🏎️ IoT Car Telemetry - Instruções de Execução

Este projeto simula um ambiente de telemetria automotiva distribuído via MQTT. Siga os passos abaixo para rodar a aplicação:

#### Opção A: Com Docker (Recomendado)
Se você possui o Docker instalado, utilize-o para subir o Broker MQTT local:
1. Abra o terminal na raiz do projeto.
2. Execute: `docker compose build`
3. Execute: `docker compose up`

#### Opção B: Sem Docker (Broker Público)
Caso não tenha Docker, você pode utilizar o broker público do **HiveMQ**:
1. No arquivo `simulator/main.py`, altere `BROKER_HOST` para `"broker.hivemq.com"`.
2. No arquivo `dashboard/src/App.jsx`, altere `BROKER_URL` para `"ws://broker.hivemq.com:8000/mqtt"`.
*Obs: Instruções detalhadas estão comentadas nos próprios arquivos.*

---

#### 🛠️ Executando os Componentes

Após configurar o Broker (via Docker ou HiveMQ), siga os passos em terminais separados:

**1. Simulador (Python)**
```bash
cd simulator
pip install -r requirements.txt
python main.py
```

**2. Dashboard (React)**
```bash
cd dashboard
npm install
npm run dev
```
Acesse o painel em: [http://localhost:5173/](http://localhost:5173/)

---
**Projeto desenvolvido para a disciplina de Internet das Coisas.**
