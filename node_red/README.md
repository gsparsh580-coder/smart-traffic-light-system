# Node-RED Dynamic Traffic Controller & Dashboard

This directory contains the central control logic for the Smart Traffic Light System. It runs an adaptive traffic timing algorithm, listens to HiveMQ MQTT broker for sensor inputs (either Synthetic Python or Real ESP32), and serves an interactive dashboard.

---

## 1. Quick Start Locally

### Option A: If you already have Node-RED installed
1. Start Node-RED:
   ```bash
   node-red
   ```
2. Open your browser at `http://localhost:1880`.
3. Install the Dashboard palette:
   - Click the hamburger menu (top right) ➔ **Manage palette** ➔ **Install** tab.
   - Search for `node-red-dashboard` and click **Install**.
4. Import the Flow:
   - Click hamburger menu ➔ **Import**.
   - Copy and paste the contents of [`flows.json`](flows.json) (or select the file).
   - Click **Import**, then click **Deploy** (top right red button).
5. Open the Node-RED UI Dashboard:
   - Go to `http://localhost:1880/ui` in your browser.

---

### Option B: Run with Docker (1-Command)
```bash
docker build -t smart-traffic-nodered .
docker run -it -p 1880:1880 --name smart-traffic-ui smart-traffic-nodered
```
Open `http://localhost:1880/ui` for the dashboard and `http://localhost:1880` for the flow editor.

---

## 2. Cloud Deployment (Render / Railway / Glitch)

You can host Node-RED 24/7 on free/starter cloud tiers so anyone in the world can access it:

### Deploying to Render.com (Web Service / Docker)
1. Fork or push this repository to GitHub.
2. Log into [Render.com](https://render.com) and click **New +** ➔ **Web Service**.
3. Connect your GitHub repository.
4. Select **Docker** as the Environment.
5. Set Root Directory to `node_red`.
6. Click **Create Web Service**.
7. Once deployed, your dashboard will be live at:
   `https://<your-service-name>.onrender.com/ui`

---

## 3. How the Dynamic Adaptive Algorithm Works

1. **Continuous Queue Monitoring**:
   - Collects live vehicle counts on all 4 lanes from topic `smart_traffic/demo/+/density`.
2. **Dynamic Green Time Allocation**:
   - Green phase length scales proportionally with queue density:
     $$T_{green} = \text{clamp}(6\text{s}, 35\text{s}, 8 + 1.8 \times \text{vehicles})$$
   - Empty lanes get quick green clears (6s) while congested lanes get up to 35s.
3. **Safety Transitions**:
   - Always gives a standard 3-second **Yellow** phase before switching green to the next lane.
   - All other 3 lanes are strictly locked in **Red**.
4. **Emergency Priority Preemption**:
   - When an ambulance/fire truck triggers an `OVERRIDE` on Lane $K$, the controller immediately terminates the active green (with 2s yellow safety buffer), then grants uninterrupted green to Lane $K$ until the override is cleared.
