/**
 * Smart Traffic Light Control System - Web Dashboard Engine
 * Handles HiveMQ MQTT over WebSockets, HTML5 Canvas 4-Way Traffic Rendering,
 * Telemetry Visualization, and Remote Actuation.
 */

(function () {
  'use strict';

  // Configuration defaults
  const config = {
    brokerHost: localStorage.getItem('cfg_broker_host') || 'broker.hivemq.com',
    brokerPort: parseInt(localStorage.getItem('cfg_broker_port') || '8884', 10),
    brokerPath: localStorage.getItem('cfg_broker_path') || '/mqtt',
    topicPrefix: localStorage.getItem('cfg_topic_prefix') || 'smart_traffic/demo'
  };

  // State
  const state = {
    connected: false,
    systemMode: 'SYNTHETIC', // 'SYNTHETIC' or 'REAL_ESP32'
    activeLane: 1,
    phase: 'GREEN',
    remainingSec: 15,
    totalPhaseSec: 15,
    emergencyActive: false,
    emergencyLane: 0,
    lanes: {
      1: { name: 'North', light: 'GREEN', vehicles: 5, distance_cm: 35 },
      2: { name: 'East',  light: 'RED',   vehicles: 3, distance_cm: 50 },
      3: { name: 'South', light: 'RED',   vehicles: 8, distance_cm: 20 },
      4: { name: 'West',  light: 'RED',   vehicles: 4, distance_cm: 42 }
    },
    localSimulationActive: true // Runs client-side fallback cycle if external controller is offline
  };

  let mqttClient = null;
  let lastMqttControllerHeartbeat = 0;

  // DOM Elements
  const elStatusBadge = document.getElementById('connectionStatusBadge');
  const elStatusDot = document.getElementById('statusDot');
  const elStatusPing = document.getElementById('statusPing');
  const elStatusText = document.getElementById('statusText');

  const elStatMode = document.getElementById('statMode');
  const elStatSourceDetail = document.getElementById('statSourceDetail');
  const elStatActiveLane = document.getElementById('statActiveLane');
  const elStatPhaseState = document.getElementById('statPhaseState');
  const elStatCountdown = document.getElementById('statCountdown');
  const elStatProgressBar = document.getElementById('statProgressBar');
  const elStatTotalVehicles = document.getElementById('statTotalVehicles');
  const elStatWaitLevel = document.getElementById('statWaitLevel');

  const elEmergencyBanner = document.getElementById('emergencyBanner');
  const elEmergencyBannerText = document.getElementById('emergencyBannerText');

  const elMqttLogContainer = document.getElementById('mqttLogContainer');
  const elTopicBaseDisplay = document.getElementById('topicBaseDisplay');

  // Canvas context
  const canvas = document.getElementById('intersectionCanvas');
  const ctx = canvas.getContext('2d');

  // ============================================================================
  // 1. MQTT CLIENT CONNECTION & HANDLERS
  // ============================================================================
  function initMqtt() {
    const clientId = 'WebDashboard_' + Math.random().toString(16).substr(2, 8);
    const wsUrl = `wss://${config.brokerHost}:${config.brokerPort}${config.brokerPath}`;

    logToConsole(`Connecting to HiveMQ WebSocket: ${wsUrl}...`, 'info');
    updateConnectionStatus('connecting');

    try {
      mqttClient = mqtt.connect(wsUrl, {
        clientId: clientId,
        clean: true,
        reconnectPeriod: 4000,
        connectTimeout: 10000,
      });

      mqttClient.on('connect', () => {
        logToConsole(`[✓] Connected to HiveMQ Broker (${config.brokerHost})`, 'success');
        updateConnectionStatus('connected');

        // Subscribe to all topics under the prefix
        const wildcardTopic = `${config.topicPrefix}/#`;
        mqttClient.subscribe(wildcardTopic, (err) => {
          if (!err) {
            logToConsole(`Subscribed to topic pattern: ${wildcardTopic}`, 'info');
          }
        });

        // Request system mode or announce presence
        publishMqtt(`${config.topicPrefix}/system/dashboard_status`, {
          client: clientId,
          status: 'ONLINE',
          timestamp: Date.now()
        });
      });

      mqttClient.on('message', onMqttMessage);

      mqttClient.on('error', (err) => {
        logToConsole(`[✗] MQTT Error: ${err.message}`, 'error');
        updateConnectionStatus('error');
      });

      mqttClient.on('close', () => {
        updateConnectionStatus('disconnected');
      });

    } catch (e) {
      logToConsole(`Failed to initialize MQTT: ${e.message}`, 'error');
      updateConnectionStatus('error');
    }
  }

  function onMqttMessage(topic, payload) {
    const rawMsg = payload.toString();
    let data;
    try {
      data = JSON.parse(rawMsg);
    } catch (e) {
      data = rawMsg;
    }

    logToConsole(`RX: ${topic} → ${typeof data === 'object' ? JSON.stringify(data) : data}`);

    // Route message by subtopic
    const subTopic = topic.replace(config.topicPrefix + '/', '');

    if (subTopic === 'control/lights') {
      lastMqttControllerHeartbeat = Date.now();
      state.localSimulationActive = false; // External controller (Node-RED/ESP32) is actively controlling

      if (typeof data === 'object') {
        state.activeLane = data.active_lane || state.activeLane;
        state.phase = data.phase || (data[`lane${state.activeLane}`] || 'GREEN');
        state.remainingSec = data.remaining_sec !== undefined ? data.remaining_sec : state.remainingSec;
        state.totalPhaseSec = data.total_phase_sec || 20;

        for (let i = 1; i <= 4; i++) {
          if (data[`lane${i}`]) {
            state.lanes[i].light = data[`lane${i}`];
          }
        }

        if (data.emergency_active !== undefined) {
          state.emergencyActive = data.emergency_active;
          state.emergencyLane = data.emergency_lane || 0;
        }

        updateUI();
      }
    } else if (subTopic.match(/^lane(\d)\/density$/)) {
      const match = subTopic.match(/^lane(\d)\/density$/);
      const laneId = parseInt(match[1], 10);
      if (typeof data === 'object') {
        state.lanes[laneId].vehicles = data.vehicle_count !== undefined ? data.vehicle_count : state.lanes[laneId].vehicles;
        state.lanes[laneId].distance_cm = data.distance_cm !== undefined ? data.distance_cm : state.lanes[laneId].distance_cm;
        if (data.source && data.source.includes('ESP32')) {
          setSystemMode('REAL_ESP32', false);
        }
      }
      updateUI();
    } else if (subTopic.match(/^lane(\d)\/light$/)) {
      const match = subTopic.match(/^lane(\d)\/light$/);
      const laneId = parseInt(match[1], 10);
      state.lanes[laneId].light = String(data).toUpperCase();
      updateUI();
    } else if (subTopic === 'control/emergency') {
      if (typeof data === 'object') {
        if (data.action === 'OVERRIDE') {
          state.emergencyActive = true;
          state.emergencyLane = data.lane || 1;
        } else if (data.action === 'CLEAR') {
          state.emergencyActive = false;
          state.emergencyLane = 0;
        }
      }
      updateUI();
    } else if (subTopic === 'system/mode') {
      const newMode = (typeof data === 'object' && data.mode) ? data.mode : String(data);
      setSystemMode(newMode, false);
    }
  }

  function publishMqtt(topic, payload, retain = false) {
    if (mqttClient && mqttClient.connected) {
      const strPayload = typeof payload === 'object' ? JSON.stringify(payload) : String(payload);
      mqttClient.publish(topic, strPayload, { qos: 0, retain: retain }, (err) => {
        if (!err) {
          logToConsole(`TX: ${topic} → ${strPayload}`);
        }
      });
    }
  }

  function updateConnectionStatus(status) {
    if (status === 'connected') {
      state.connected = true;
      elStatusDot.className = 'relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500';
      elStatusPing.className = 'animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75';
      elStatusText.textContent = `Connected (${config.brokerHost})`;
      elStatusText.className = 'text-xs font-mono font-medium text-emerald-400';
    } else if (status === 'connecting') {
      elStatusDot.className = 'relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500';
      elStatusPing.className = 'animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75';
      elStatusText.textContent = 'Connecting...';
      elStatusText.className = 'text-xs font-mono font-medium text-amber-400';
    } else {
      state.connected = false;
      elStatusDot.className = 'relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500';
      elStatusPing.className = 'hidden';
      elStatusText.textContent = 'Disconnected';
      elStatusText.className = 'text-xs font-mono font-medium text-red-400';
    }
  }

  function logToConsole(message, type = 'normal') {
    const time = new Date().toTimeString().split(' ')[0];
    const line = document.createElement('div');
    if (type === 'success') line.className = 'text-emerald-400 font-semibold';
    else if (type === 'error') line.className = 'text-rose-400 font-semibold';
    else if (type === 'info') line.className = 'text-sky-400';
    else line.className = 'text-slate-400';

    line.textContent = `[${time}] ${message}`;
    elMqttLogContainer.appendChild(line);

    // Limit log lines to 150
    if (elMqttLogContainer.children.length > 150) {
      elMqttLogContainer.removeChild(elMqttLogContainer.firstChild);
    }
    elMqttLogContainer.scrollTop = elMqttLogContainer.scrollHeight;
  }

  // ============================================================================
  // 2. FALLBACK INTERNAL CONTROLLER (STANDALONE DEMO MODE)
  // ============================================================================
  // Runs client-side cycle if Node-RED is not running yet
  setInterval(() => {
    // If no remote controller message received within 5 seconds, fallback to local controller
    if (Date.now() - lastMqttControllerHeartbeat > 5000) {
      state.localSimulationActive = true;
    }

    if (state.localSimulationActive) {
      stepLocalTrafficCycle();
    }
  }, 1000);

  function stepLocalTrafficCycle() {
    state.remainingSec--;

    if (state.emergencyActive && state.emergencyLane >= 1 && state.emergencyLane <= 4) {
      // Emergency priority holds active lane
      if (state.activeLane !== state.emergencyLane) {
        state.activeLane = state.emergencyLane;
        state.phase = 'GREEN';
        state.remainingSec = 20;
      }
    } else if (state.remainingSec <= 0) {
      if (state.phase === 'GREEN') {
        state.phase = 'YELLOW';
        state.remainingSec = 3;
      } else {
        state.activeLane = (state.activeLane % 4) + 1;
        state.phase = 'GREEN';
        // Adaptive time based on queue
        const cars = state.lanes[state.activeLane].vehicles;
        state.totalPhaseSec = Math.min(30, Math.max(8, 8 + Math.round(cars * 1.5)));
        state.remainingSec = state.totalPhaseSec;
      }
    }

    // Update lane light states
    for (let i = 1; i <= 4; i++) {
      state.lanes[i].light = (i === state.activeLane) ? state.phase : 'RED';
    }

    updateUI();
  }

  // ============================================================================
  // 3. UI STATE UPDATER
  // ============================================================================
  function updateUI() {
    // Stats cards
    const laneNames = { 1: 'Lane 1 (North)', 2: 'Lane 2 (East)', 3: 'Lane 3 (South)', 4: 'Lane 4 (West)' };
    elStatActiveLane.textContent = laneNames[state.activeLane];
    elStatPhaseState.textContent = `Status: ${state.phase}`;
    elStatCountdown.textContent = Math.max(0, state.remainingSec);

    // Progress bar
    const pct = Math.max(0, Math.min(100, (state.remainingSec / (state.totalPhaseSec || 15)) * 100));
    elStatProgressBar.style.width = `${pct}%`;
    elStatProgressBar.className = (state.phase === 'GREEN') ? 'bg-emerald-500 h-full transition-all duration-300' :
                                  (state.phase === 'YELLOW') ? 'bg-amber-400 h-full transition-all duration-300' :
                                  'bg-red-500 h-full transition-all duration-300';

    // Total vehicles
    let totalCars = 0;
    for (let i = 1; i <= 4; i++) totalCars += state.lanes[i].vehicles;
    elStatTotalVehicles.textContent = totalCars;
    if (totalCars < 10) {
      elStatWaitLevel.textContent = 'Light Flow';
      elStatWaitLevel.className = 'text-xs text-emerald-400 font-medium';
    } else if (totalCars < 24) {
      elStatWaitLevel.textContent = 'Moderate Flow';
      elStatWaitLevel.className = 'text-xs text-amber-400 font-medium';
    } else {
      elStatWaitLevel.textContent = 'Heavy Congestion';
      elStatWaitLevel.className = 'text-xs text-rose-400 font-medium';
    }

    // 4 Lane cards
    for (let i = 1; i <= 4; i++) {
      const lane = state.lanes[i];
      const card = document.getElementById(`laneCard${i}`);
      const badge = document.getElementById(`lane${i}Badge`);
      const dist = document.getElementById(`lane${i}Dist`);
      const cars = document.getElementById(`lane${i}Cars`);
      const bar = document.getElementById(`lane${i}Bar`);

      if (dist) dist.textContent = lane.distance_cm;
      if (cars) cars.textContent = lane.vehicles;

      const barPct = Math.min(100, Math.round((lane.vehicles / 25) * 100));
      if (bar) {
        bar.style.width = `${barPct}%`;
        bar.className = (lane.light === 'GREEN') ? 'bg-emerald-500 h-full transition-all duration-300' :
                        (lane.light === 'YELLOW') ? 'bg-amber-400 h-full transition-all duration-300' :
                        'bg-red-500 h-full transition-all duration-300';
      }

      if (badge) {
        badge.textContent = lane.light;
        if (lane.light === 'GREEN') {
          badge.className = 'text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30';
          if (card) card.classList.add('active-lane-glow');
        } else if (lane.light === 'YELLOW') {
          badge.className = 'text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30';
          if (card) card.classList.remove('active-lane-glow');
        } else {
          badge.textContent = 'RED';
          badge.className = 'text-[10px] font-mono px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/30';
          if (card) card.classList.remove('active-lane-glow');
        }
      }
    }

    // Emergency Banner
    if (state.emergencyActive && state.emergencyLane > 0) {
      elEmergencyBanner.classList.remove('hidden');
      elEmergencyBannerText.textContent = `EMERGENCY VEHICLE APPROACHING ON LANE ${state.emergencyLane} (${laneNames[state.emergencyLane]})`;
    } else {
      elEmergencyBanner.classList.add('hidden');
    }
  }

  function setSystemMode(mode, publish = true) {
    state.systemMode = mode;
    const btnSyn = document.getElementById('btnSwitchModeSynthetic');
    const btnReal = document.getElementById('btnSwitchModeReal');

    if (mode === 'REAL_ESP32') {
      elStatMode.innerHTML = '<i class="fa-solid fa-wifi text-emerald-400"></i> <span>ESP32 SENSORS</span>';
      elStatSourceDetail.textContent = 'Hardware HC-SR04 Nodes';
      btnReal.className = 'px-2 py-1 text-xs font-semibold rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30 transition';
      btnSyn.className = 'px-2 py-1 text-xs font-semibold rounded bg-slate-800 border border-slate-700 text-slate-400 hover:text-white transition';
    } else {
      elStatMode.innerHTML = '<i class="fa-solid fa-microchip text-teal-400"></i> <span>SYNTHETIC</span>';
      elStatSourceDetail.textContent = 'Python / Cloud Simulator';
      btnSyn.className = 'px-2 py-1 text-xs font-semibold rounded bg-teal-500/20 border border-teal-500/40 text-teal-300 hover:bg-teal-500/30 transition';
      btnReal.className = 'px-2 py-1 text-xs font-semibold rounded bg-slate-800 border border-slate-700 text-slate-400 hover:text-white transition';
    }

    if (publish) {
      publishMqtt(`${config.topicPrefix}/system/mode`, { mode: mode, timestamp: Date.now() }, true);
    }
  }

  // ============================================================================
  // 4. ANIMATED 2D 4-WAY INTERSECTION CANVAS
  // ============================================================================
  const cars = [];
  const CAR_COLORS = ['#38bdf8', '#fbbf24', '#f43f5e', '#a855f7', '#34d399', '#f97316'];

  class Vehicle {
    constructor(lane) {
      this.lane = lane; // 1: North (heading S), 2: East (heading W), 3: South (heading N), 4: West (heading E)
      this.color = CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];
      this.width = 18;
      this.length = 34;
      this.speed = 2.5 + Math.random() * 0.8;
      this.isEmergency = (state.emergencyActive && state.emergencyLane === lane && Math.random() < 0.4);

      if (this.isEmergency) {
        this.color = '#ef4444';
      }

      // Initialize position along road
      if (lane === 1) { // North -> South
        this.x = 280;
        this.y = -40;
        this.stopLine = 220;
      } else if (lane === 2) { // East -> West
        this.x = 640;
        this.y = 280;
        this.stopLine = 380;
      } else if (lane === 3) { // South -> North
        this.x = 320;
        this.y = 640;
        this.stopLine = 380;
      } else if (lane === 4) { // West -> East
        this.x = -40;
        this.y = 320;
        this.stopLine = 220;
      }
    }

    update(leadingCar) {
      const light = state.lanes[this.lane].light;
      const mustStop = (light === 'RED' || light === 'YELLOW');
      let targetSpeed = this.speed;

      // Distance to stop line or car ahead
      if (this.lane === 1) {
        if (mustStop && this.y < this.stopLine && this.y + 40 >= this.stopLine) {
          targetSpeed = 0;
        }
        if (leadingCar && (leadingCar.y - (this.y + this.length)) < 15) {
          targetSpeed = 0;
        }
        this.y += targetSpeed;
      } else if (this.lane === 2) {
        if (mustStop && this.x > this.stopLine && this.x - 40 <= this.stopLine) {
          targetSpeed = 0;
        }
        if (leadingCar && ((this.x - this.length) - leadingCar.x) < 15) {
          targetSpeed = 0;
        }
        this.x -= targetSpeed;
      } else if (this.lane === 3) {
        if (mustStop && this.y > this.stopLine && this.y - 40 <= this.stopLine) {
          targetSpeed = 0;
        }
        if (leadingCar && ((this.y - this.length) - leadingCar.y) < 15) {
          targetSpeed = 0;
        }
        this.y -= targetSpeed;
      } else if (this.lane === 4) {
        if (mustStop && this.x < this.stopLine && this.x + 40 >= this.stopLine) {
          targetSpeed = 0;
        }
        if (leadingCar && (leadingCar.x - (this.x + this.length)) < 15) {
          targetSpeed = 0;
        }
        this.x += targetSpeed;
      }
    }

    draw(ctx) {
      ctx.save();
      ctx.fillStyle = this.color;
      ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
      ctx.shadowBlur = 6;

      if (this.lane === 1 || this.lane === 3) {
        // Vertical cars
        ctx.beginPath();
        ctx.roundRect(this.x - this.width / 2, this.y - this.length / 2, this.width, this.length, 4);
        ctx.fill();

        // Windshields
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(this.x - this.width / 2 + 2, this.y - 8, this.width - 4, 6);

        // Flashing light if emergency
        if (this.isEmergency) {
          ctx.fillStyle = (Math.floor(Date.now() / 150) % 2 === 0) ? '#38bdf8' : '#ef4444';
          ctx.beginPath();
          ctx.arc(this.x, this.y, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        // Horizontal cars
        ctx.beginPath();
        ctx.roundRect(this.x - this.length / 2, this.y - this.width / 2, this.length, this.width, 4);
        ctx.fill();

        // Windshields
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(this.x - 8, this.y - this.width / 2 + 2, 6, this.width - 4);

        if (this.isEmergency) {
          ctx.fillStyle = (Math.floor(Date.now() / 150) % 2 === 0) ? '#38bdf8' : '#ef4444';
          ctx.beginPath();
          ctx.arc(this.x, this.y, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      ctx.restore();
    }

    isOutOfBounds() {
      return (this.x < -60 || this.x > 660 || this.y < -60 || this.y > 660);
    }
  }

  // Spawn cars based on lane vehicle density
  setInterval(() => {
    for (let lane = 1; lane <= 4; lane++) {
      const activeLaneCars = cars.filter(c => c.lane === lane);
      const targetCount = Math.min(10, Math.ceil(state.lanes[lane].vehicles / 2.5));

      if (activeLaneCars.length < targetCount && Math.random() < 0.6) {
        cars.push(new Vehicle(lane));
      }
    }
  }, 1200);

  function drawIntersection() {
    ctx.clearRect(0, 0, 600, 600);

    // 1. Grass / Ground Background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, 600, 600);

    // Corner lawns
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, 240, 240);
    ctx.fillRect(360, 0, 240, 240);
    ctx.fillRect(0, 360, 240, 240);
    ctx.fillRect(360, 360, 240, 240);

    // 2. Asphalt Roads
    ctx.fillStyle = '#1e293b';
    // Vertical Road (Lanes 1 & 3)
    ctx.fillRect(240, 0, 120, 600);
    // Horizontal Road (Lanes 2 & 4)
    ctx.fillRect(0, 240, 600, 120);

    // Intersection Box
    ctx.fillStyle = '#243044';
    ctx.fillRect(240, 240, 120, 120);

    // 3. Road Markings & Dashed Lines
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 8]);

    // Center divider lines
    ctx.beginPath();
    ctx.moveTo(300, 0); ctx.lineTo(300, 240);
    ctx.moveTo(300, 360); ctx.lineTo(300, 600);
    ctx.moveTo(0, 300); ctx.lineTo(240, 300);
    ctx.moveTo(360, 300); ctx.lineTo(600, 300);
    ctx.stroke();
    ctx.setLineDash([]); // reset

    // Stop Lines (Solid White)
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(240, 235); ctx.lineTo(300, 235); // Lane 1 stop line
    ctx.moveTo(365, 240); ctx.lineTo(365, 300); // Lane 2 stop line
    ctx.moveTo(300, 365); ctx.lineTo(360, 365); // Lane 3 stop line
    ctx.moveTo(235, 300); ctx.lineTo(235, 360); // Lane 4 stop line
    ctx.stroke();

    // 4. Update and Draw Cars
    for (let lane = 1; lane <= 4; lane++) {
      const laneCars = cars.filter(c => c.lane === lane);
      for (let i = 0; i < laneCars.length; i++) {
        const leadingCar = (i > 0) ? laneCars[i - 1] : null;
        laneCars[i].update(leadingCar);
        laneCars[i].draw(ctx);
      }
    }

    // Filter out of bounds
    for (let i = cars.length - 1; i >= 0; i--) {
      if (cars[i].isOutOfBounds()) cars.splice(i, 1);
    }

    // 5. Draw 4 Traffic Light Posts
    drawTrafficLightPost(ctx, 215, 210, state.lanes[1].light, 'N');
    drawTrafficLightPost(ctx, 385, 215, state.lanes[2].light, 'E');
    drawTrafficLightPost(ctx, 385, 390, state.lanes[3].light, 'S');
    drawTrafficLightPost(ctx, 215, 385, state.lanes[4].light, 'W');

    requestAnimationFrame(drawIntersection);
  }

  function drawTrafficLightPost(ctx, x, y, lightState, orientation) {
    ctx.save();
    ctx.translate(x, y);

    // Housing box
    ctx.fillStyle = '#020617';
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(-10, -22, 20, 44, 4);
    ctx.fill();
    ctx.stroke();

    // Bulbs (Red, Yellow, Green)
    const redOn = (lightState === 'RED');
    const yellowOn = (lightState === 'YELLOW');
    const greenOn = (lightState === 'GREEN');

    // Red Bulb
    ctx.fillStyle = redOn ? '#ef4444' : '#450a0a';
    ctx.shadowColor = redOn ? '#ef4444' : 'transparent';
    ctx.shadowBlur = redOn ? 10 : 0;
    ctx.beginPath();
    ctx.arc(0, -12, 5, 0, Math.PI * 2);
    ctx.fill();

    // Yellow Bulb
    ctx.fillStyle = yellowOn ? '#facc15' : '#422006';
    ctx.shadowColor = yellowOn ? '#facc15' : 'transparent';
    ctx.shadowBlur = yellowOn ? 10 : 0;
    ctx.beginPath();
    ctx.arc(0, 0, 5, 0, Math.PI * 2);
    ctx.fill();

    // Green Bulb
    ctx.fillStyle = greenOn ? '#22c55e' : '#052e16';
    ctx.shadowColor = greenOn ? '#22c55e' : 'transparent';
    ctx.shadowBlur = greenOn ? 12 : 0;
    ctx.beginPath();
    ctx.arc(0, 12, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // ============================================================================
  // 5. EXTERNAL API EXPOSURE FOR UI ACTIONS
  // ============================================================================
  window.TrafficApp = {
    triggerEmergency: function (laneId) {
      state.emergencyActive = true;
      state.emergencyLane = laneId;
      state.lanes[laneId].vehicles = Math.max(state.lanes[laneId].vehicles, 12);
      publishMqtt(`${config.topicPrefix}/control/emergency`, {
        action: 'OVERRIDE',
        lane: laneId,
        source: 'WebDashboard',
        timestamp: Date.now()
      });
      logToConsole(`[🚨 EMERGENCY] Ambulance dispatched to Lane ${laneId}!`, 'error');
      updateUI();
    },

    clearEmergency: function () {
      state.emergencyActive = false;
      state.emergencyLane = 0;
      publishMqtt(`${config.topicPrefix}/control/emergency`, {
        action: 'CLEAR',
        lane: 0,
        source: 'WebDashboard',
        timestamp: Date.now()
      });
      logToConsole('[✓] Emergency Cleared. Normal cycle restored.', 'success');
      updateUI();
    },

    forceLaneGreen: function (laneId) {
      state.activeLane = laneId;
      state.phase = 'GREEN';
      state.remainingSec = 20;
      state.totalPhaseSec = 20;
      for (let i = 1; i <= 4; i++) {
        state.lanes[i].light = (i === laneId) ? 'GREEN' : 'RED';
      }
      publishMqtt(`${config.topicPrefix}/control/manual`, {
        action: 'FORCE_LANE',
        lane: laneId
      });
      logToConsole(`Manual Action: Forced Lane ${laneId} to GREEN`, 'info');
      updateUI();
    },

    forceAllRed: function () {
      state.phase = 'RED';
      for (let i = 1; i <= 4; i++) {
        state.lanes[i].light = 'RED';
      }
      publishMqtt(`${config.topicPrefix}/control/manual`, {
        action: 'ALL_RED'
      });
      logToConsole('Manual Action: Intersection locked in ALL RED', 'error');
      updateUI();
    },

    resumeAuto: function () {
      state.localSimulationActive = true;
      publishMqtt(`${config.topicPrefix}/control/manual`, {
        action: 'RESUME_AUTO'
      });
      logToConsole('Manual Action: Resumed Automatic Adaptive Cycle', 'success');
      updateUI();
    },

    applyPreset: function (preset) {
      if (preset === 'morning') {
        state.lanes[1].vehicles = 22; state.lanes[1].distance_cm = 10;
        state.lanes[2].vehicles = 4;  state.lanes[2].distance_cm = 75;
        state.lanes[3].vehicles = 18; state.lanes[3].distance_cm = 15;
        state.lanes[4].vehicles = 3;  state.lanes[4].distance_cm = 80;
        logToConsole('Preset applied: Morning Commute Rush (Heavy North-South)', 'info');
      } else if (preset === 'evening') {
        state.lanes[1].vehicles = 5;  state.lanes[1].distance_cm = 70;
        state.lanes[2].vehicles = 25; state.lanes[2].distance_cm = 8;
        state.lanes[3].vehicles = 6;  state.lanes[3].distance_cm = 65;
        state.lanes[4].vehicles = 20; state.lanes[4].distance_cm = 12;
        logToConsole('Preset applied: Evening Commute Rush (Heavy East-West)', 'info');
      } else if (preset === 'lull') {
        for (let i = 1; i <= 4; i++) {
          state.lanes[i].vehicles = 1;
          state.lanes[i].distance_cm = 95;
        }
        logToConsole('Preset applied: Midnight Lull (Sparse Traffic)', 'info');
      }

      // Publish new density to broker
      for (let i = 1; i <= 4; i++) {
        publishMqtt(`${config.topicPrefix}/lane${i}/density`, {
          lane: i,
          vehicle_count: state.lanes[i].vehicles,
          distance_cm: state.lanes[i].distance_cm,
          source: 'WebDashboard_Preset'
        });
      }
      updateUI();
    }
  };

  // Event Listeners
  document.getElementById('btnSwitchModeSynthetic').addEventListener('click', () => setSystemMode('SYNTHETIC'));
  document.getElementById('btnSwitchModeReal').addEventListener('click', () => setSystemMode('REAL_ESP32'));
  document.getElementById('btnBannerClear').addEventListener('click', () => window.TrafficApp.clearEmergency());
  document.getElementById('btnClearLogs').addEventListener('click', () => {
    elMqttLogContainer.innerHTML = '<div class="text-slate-500 italic">[Logs cleared]</div>';
  });

  // Settings modal
  const modal = document.getElementById('settingsModal');
  document.getElementById('btnOpenSettings').addEventListener('click', () => modal.classList.remove('hidden'));
  document.getElementById('btnCloseSettings').addEventListener('click', () => modal.classList.add('hidden'));

  document.getElementById('btnSaveSettings').addEventListener('click', () => {
    config.brokerHost = document.getElementById('cfgBrokerHost').value.trim();
    config.brokerPort = parseInt(document.getElementById('cfgBrokerPort').value.trim(), 10);
    config.brokerPath = document.getElementById('cfgBrokerPath').value.trim();
    config.topicPrefix = document.getElementById('cfgTopicPrefix').value.trim();

    localStorage.setItem('cfg_broker_host', config.brokerHost);
    localStorage.setItem('cfg_broker_port', config.brokerPort);
    localStorage.setItem('cfg_broker_path', config.brokerPath);
    localStorage.setItem('cfg_topic_prefix', config.topicPrefix);

    elTopicBaseDisplay.textContent = `Topic: ${config.topicPrefix}/#`;
    modal.classList.add('hidden');

    if (mqttClient) mqttClient.end(true);
    initMqtt();
  });

  // Update GitHub link in navbar if hosted on GitHub Pages
  if (window.location.hostname.includes('github.io')) {
    const parts = window.location.pathname.split('/').filter(Boolean);
    if (parts.length > 0) {
      const repoName = parts[0];
      const user = window.location.hostname.split('.')[0];
      document.getElementById('repoLink').href = `https://github.com/${user}/${repoName}`;
    }
  }

  // Initialize
  elTopicBaseDisplay.textContent = `Topic: ${config.topicPrefix}/#`;
  initMqtt();
  updateUI();
  requestAnimationFrame(drawIntersection);

})();
