# ESP32 Smart Traffic Light System - Hardware & Wiring Guide

This guide details the physical hardware wiring between the ESP32 microcontroller, ultrasonic distance sensors (or IR sensors), and traffic light LEDs.

---

## 1. Components Checklist

| Component | Quantity | Purpose |
|---|---|---|
| **ESP32 DevKit V1** (30 or 38 pin) | 1 | Central controller & MQTT client |
| **HC-SR04 Ultrasonic Sensors** (or IR Obstacle Sensors) | 4 (or 2 for demo) | Vehicle queue distance measurement |
| **Traffic Light LEDs** (Red, Yellow, Green) | 12 (or 6 for 2-lane demo) | Visual light actuation |
| **Resistors (220Ω - 330Ω)** | 12 | Current limiting for LEDs |
| **Pushbutton** | 1 | Manual Emergency / Pedestrian interrupt |
| **Breadboard & Jumper Wires** | Multiple | Prototyping & connections |
| **Micro-USB Cable / 5V Supply** | 1 | Powering ESP32 |

---

## 2. Complete ESP32 Pin Allocation

### A. Ultrasonic Distance Sensors (HC-SR04)
> **Note on HC-SR04 Voltage:** HC-SR04 VCC requires 5V. The Echo pin outputs 5V logic; while ESP32 GPIOs tolerate brief 5V pulses, using a simple 1kΩ/2kΩ voltage divider or 3.3V compatible sensor (HC-SR04P / RCWL-1601) is recommended for production.

| Intersection Lane | Sensor Signal | ESP32 GPIO |
|---|---|---|
| **Lane 1 (North)** | Trigger | `GPIO 5` |
| | Echo | `GPIO 18` |
| **Lane 2 (East)** | Trigger | `GPIO 19` |
| | Echo | `GPIO 21` |
| **Lane 3 (South)** | Trigger | `GPIO 22` |
| | Echo | `GPIO 23` |
| **Lane 4 (West)** | Trigger | `GPIO 25` |
| | Echo | `GPIO 26` |

*VCC → ESP32 5V (VIN) pin, GND → ESP32 GND.*

---

### B. Traffic Light LEDs

Each LED anode (+) connects through a **220Ω resistor** to the ESP32 GPIO. The cathode (-) connects to common **GND**.

| Intersection Lane | Color | ESP32 GPIO |
|---|---|---|
| **Lane 1 (North)** | 🔴 Red | `GPIO 13` |
| | 🟡 Yellow | `GPIO 12` |
| | 🟢 Green | `GPIO 14` |
| **Lane 2 (East)** | 🔴 Red | `GPIO 27` |
| | 🟡 Yellow | `GPIO 33` |
| | 🟢 Green | `GPIO 32` |
| **Lane 3 (South)** | 🔴 Red | `GPIO 15` |
| | 🟡 Yellow | `GPIO 2` |
| | 🟢 Green | `GPIO 4` |
| **Lane 4 (West)** | 🔴 Red | `GPIO 16` |
| | 🟡 Yellow | `GPIO 17` |
| | 🟢 Green | `GPIO 5` *(shared or remapped)* |

---

### C. Emergency Override Button
- **Pin**: `GPIO 34` (Configured as `INPUT_PULLUP`)
- Pushbutton Terminal 1 → `GPIO 34`
- Pushbutton Terminal 2 → `GND`
- Pressing button pulls GPIO 34 LOW to trigger instant emergency vehicle dispatch.

---

## 3. Simplified 2-Lane Crossroad Option (For Quick Breadboard Testing)

If you only have 2 ultrasonic sensors and 6 LEDs:
1. Open `esp32_firmware/esp32_smart_traffic.ino`
2. Change `#define NUM_LANES 4` to `#define NUM_LANES 2`
3. Wire only **Lane 1** and **Lane 2**. The firmware automatically adjusts the round-robin cycle and adaptive algorithm.

---

## 4. Alternative: IR Proximity Sensors

If using Digital IR Obstacle Avoidance Sensors (3-pin: VCC, GND, OUT):
- Connect `OUT` to the respective Lane Echo/Trig pin.
- When a car blocks the IR beam, `OUT` goes `LOW` indicating vehicle present.
