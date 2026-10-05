#!/usr/bin/env python3
"""
Smart Traffic Light Control System - Synthetic Traffic Data Generator
Simulates realistic 4-way intersection vehicle queues, arrival rates,
and emergency vehicle events, publishing live telemetry to HiveMQ MQTT.
"""

import sys
import time
import json
import random
import argparse
import threading
from datetime import datetime

try:
    import paho.mqtt.client as mqtt
    from paho.mqtt.enums import CallbackAPIVersion
    PAHO_V2 = True
except (ImportError, AttributeError):
    try:
        import paho.mqtt.client as mqtt
        PAHO_V2 = False
    except ImportError:
        print("[!] paho-mqtt is required. Run: pip install paho-mqtt")
        sys.exit(1)

# Default Configuration
DEFAULT_BROKER = "broker.hivemq.com"
DEFAULT_PORT = 1883
DEFAULT_TOPIC_PREFIX = "smart_traffic/demo"

# Terminal Color Codes
CYAN = "\033[96m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
MAGENTA = "\033[95m"
BOLD = "\033[1m"
RESET = "\033[0m"


class TrafficSimulator:
    def __init__(self, broker, port, prefix, interval=2.0):
        self.broker = broker
        self.port = port
        self.prefix = prefix.rstrip("/")
        self.interval = interval
        self.running = False

        # Lane States: vehicle count (0 to 30)
        self.lanes = {
            1: {"name": "Northbound", "vehicles": 5, "distance_cm": 35, "light": "RED"},
            2: {"name": "Eastbound",  "vehicles": 3, "distance_cm": 50, "light": "RED"},
            3: {"name": "Southbound", "vehicles": 8, "distance_cm": 20, "light": "RED"},
            4: {"name": "Westbound",  "vehicles": 4, "distance_cm": 42, "light": "RED"},
        }

        # Simulation Mode: AUTO, RUSH_HOUR, BALANCED, MANUAL
        self.sim_mode = "AUTO"
        self.emergency_lane = None
        self.active_system_mode = "SYNTHETIC"  # or REAL_ESP32
        self.light_cycle_info = {"active_lane": 1, "remaining_sec": 0}

        # Setup MQTT Client
        client_id = f"TrafficSimulator_{random.randint(1000, 9999)}"
        if PAHO_V2:
            self.client = mqtt.Client(CallbackAPIVersion.VERSION2, client_id=client_id)
        else:
            self.client = mqtt.Client(client_id=client_id)

        self.client.on_connect = self._on_connect
        self.client.on_message = self._on_message
        self.client.on_disconnect = self._on_disconnect

    def _on_connect(self, client, userdata, flags, rc, properties=None):
        if rc == 0:
            print(f"{GREEN}[✓] Connected to HiveMQ Broker ({self.broker}:{self.port}){RESET}")
            # Subscribe to traffic light state and system mode updates
            client.subscribe(f"{self.prefix}/control/lights")
            client.subscribe(f"{self.prefix}/system/mode")
            client.subscribe(f"{self.prefix}/control/emergency")
            
            # Announce synthetic mode is active
            self.publish_system_mode()
        else:
            print(f"{RED}[✗] Connection failed with code {rc}{RESET}")

    def _on_disconnect(self, client, userdata, rc, properties=None):
        print(f"{YELLOW}[!] Disconnected from broker (rc={rc}){RESET}")

    def _on_message(self, client, userdata, msg):
        topic = msg.topic
        payload_str = msg.payload.decode("utf-8", errors="ignore")
        try:
            data = json.loads(payload_str)
        except Exception:
            data = payload_str

        # Update lights feedback from Node-RED or controller
        if topic == f"{self.prefix}/control/lights":
            if isinstance(data, dict):
                for lane_id in (1, 2, 3, 4):
                    lane_key = f"lane{lane_id}"
                    if lane_key in data:
                        self.lanes[lane_id]["light"] = data[lane_key]
                self.light_cycle_info["active_lane"] = data.get("active_lane", 1)
                self.light_cycle_info["remaining_sec"] = data.get("remaining_sec", 0)

        elif topic == f"{self.prefix}/system/mode":
            if isinstance(data, dict):
                self.active_system_mode = data.get("mode", self.active_system_mode)
            else:
                self.active_system_mode = str(data)

        elif topic == f"{self.prefix}/control/emergency":
            if isinstance(data, dict):
                if data.get("action") == "OVERRIDE":
                    self.emergency_lane = data.get("lane")
                elif data.get("action") == "CLEAR":
                    self.emergency_lane = None

    def publish_system_mode(self):
        payload = {
            "mode": "SYNTHETIC",
            "source": "Python Traffic Simulator",
            "timestamp": int(time.time()),
        }
        self.client.publish(f"{self.prefix}/system/mode", json.dumps(payload), retain=True)

    def publish_lane_density(self, lane_id):
        lane = self.lanes[lane_id]
        # Invert distance for sensor emulation: high vehicles = short ultrasonic distance (cm)
        # 0 vehicles ~ 100cm, 20 vehicles ~ 10cm
        sensor_dist = max(5, int(100 - (lane["vehicles"] * 4.5)))
        lane["distance_cm"] = sensor_dist

        payload = {
            "lane": lane_id,
            "lane_name": lane["name"],
            "vehicle_count": lane["vehicles"],
            "queue_length_m": lane["vehicles"] * 5.0,  # avg 5m per vehicle
            "distance_cm": sensor_dist,
            "is_emergency": (self.emergency_lane == lane_id),
            "timestamp": int(time.time()),
        }
        topic = f"{self.prefix}/lane{lane_id}/density"
        self.client.publish(topic, json.dumps(payload))

    def trigger_emergency(self, lane_id):
        self.emergency_lane = lane_id
        # Boost lane vehicles to represent congestion behind emergency vehicle
        self.lanes[lane_id]["vehicles"] = max(self.lanes[lane_id]["vehicles"], 12)
        payload = {
            "action": "OVERRIDE",
            "lane": lane_id,
            "vehicle_type": "AMBULANCE",
            "timestamp": int(time.time())
        }
        self.client.publish(f"{self.prefix}/control/emergency", json.dumps(payload))
        print(f"\n{RED}{BOLD}[🚨 EMERGENCY VEHICLE TRIGGERED ON LANE {lane_id} ({self.lanes[lane_id]['name']})!]{RESET}\n")

    def clear_emergency(self):
        self.emergency_lane = None
        payload = {
            "action": "CLEAR",
            "lane": 0,
            "timestamp": int(time.time())
        }
        self.client.publish(f"{self.prefix}/control/emergency", json.dumps(payload))
        print(f"\n{GREEN}[✓ Emergency status cleared]{RESET}\n")

    def update_simulation_physics(self):
        """Simulate vehicle arrivals and departures based on traffic light states"""
        for lane_id, lane in self.lanes.items():
            is_green = (lane["light"] == "GREEN")

            # 1. Vehicles depart if light is GREEN
            if is_green and lane["vehicles"] > 0:
                departure_rate = random.randint(1, 3)
                lane["vehicles"] = max(0, lane["vehicles"] - departure_rate)

            # 2. Vehicle arrivals depending on simulation profile
            if self.sim_mode == "RUSH_HOUR":
                # Heavy traffic on Lanes 1 & 3 (North-South arterial road)
                if lane_id in (1, 3):
                    arrivals = random.choices([1, 2, 3, 4], weights=[0.2, 0.4, 0.3, 0.1])[0]
                else:
                    arrivals = random.choices([0, 1, 2], weights=[0.6, 0.3, 0.1])[0]
            elif self.sim_mode == "BALANCED":
                arrivals = random.choices([0, 1, 2], weights=[0.4, 0.4, 0.2])[0]
            else:  # AUTO with natural random waves
                arrivals = random.choices([0, 1, 2, 3], weights=[0.35, 0.4, 0.2, 0.05])[0]

            # Clamp max queue to 30
            lane["vehicles"] = min(30, lane["vehicles"] + arrivals)

    def print_terminal_dashboard(self):
        # Clear line and print compact status board
        sys.stdout.write("\033[H\033[J")  # ANSI clear screen
        print(f"{CYAN}{BOLD}========================================================================{RESET}")
        print(f"{CYAN}{BOLD}       SMART TRAFFIC LIGHT SYSTEM - SYNTHETIC DATA SIMULATOR           {RESET}")
        print(f"{CYAN}{BOLD}========================================================================{RESET}")
        print(f"Broker: {self.broker}:{self.port} | Topic Prefix: {self.prefix}")
        print(f"System Mode: {MAGENTA}{self.active_system_mode}{RESET} | Simulation Profile: {YELLOW}{self.sim_mode}{RESET}")
        if self.emergency_lane:
            print(f"Emergency Status: {RED}{BOLD}ACTIVE ON LANE {self.emergency_lane} ({self.lanes[self.emergency_lane]['name']}){RESET}")
        else:
            print(f"Emergency Status: {GREEN}NORMAL{RESET}")
        print("-" * 72)

        # Print 4 lanes
        for lane_id, data in self.lanes.items():
            light_color = RED if data["light"] == "RED" else (YELLOW if data["light"] == "YELLOW" else GREEN)
            light_badge = f"{light_color}[ {data['light']:^6} ]{RESET}"
            bar_len = min(25, data["vehicles"])
            queue_bar = f"{CYAN}{'█' * bar_len}{'░' * (25 - bar_len)}{RESET}"
            emerg_tag = f" {RED}{BOLD}[EMERGENCY]{RESET}" if self.emergency_lane == lane_id else ""

            print(f"Lane {lane_id} ({data['name']:<11}): {light_badge}  Queue: {queue_bar} ({data['vehicles']:2d} cars, {data['distance_cm']:3d}cm){emerg_tag}")

        print("-" * 72)
        print(f"Controls: [1-4] Emergency on Lane | [C] Clear Emergency | [R] Rush Hour")
        print(f"          [B] Balanced Mode     | [A] Auto Mode        | [Q] Quit")
        print(f"Updated: {datetime.now().strftime('%H:%M:%S')} (publishing every {self.interval}s)")

    def run(self):
        self.running = True
        print(f"Connecting to {self.broker}...")
        try:
            self.client.connect(self.broker, self.port, 60)
            self.client.loop_start()
        except Exception as e:
            print(f"{RED}Failed to connect: {e}{RESET}")
            return

        # Start input listener thread
        input_thread = threading.Thread(target=self._keyboard_listener, daemon=True)
        input_thread.start()

        try:
            while self.running:
                # Update simulation physics
                self.update_simulation_physics()

                # Publish data for all 4 lanes
                for lane_id in range(1, 5):
                    self.publish_lane_density(lane_id)

                # Render dashboard to terminal
                self.print_terminal_dashboard()

                time.sleep(self.interval)
        except KeyboardInterrupt:
            print("\nShutting down simulator...")
        finally:
            self.client.loop_stop()
            self.client.disconnect()
            print("Simulator stopped.")

    def _keyboard_listener(self):
        """Simple interactive CLI listener without external key-listener dependencies"""
        while self.running:
            try:
                line = sys.stdin.readline().strip().lower()
                if not line:
                    continue
                cmd = line[0]
                if cmd in ("1", "2", "3", "4"):
                    self.trigger_emergency(int(cmd))
                elif cmd == "c":
                    self.clear_emergency()
                elif cmd == "r":
                    self.sim_mode = "RUSH_HOUR"
                    print(f"\n{YELLOW}[Mode switched to RUSH_HOUR: High North-South Traffic]{RESET}")
                elif cmd == "b":
                    self.sim_mode = "BALANCED"
                    print(f"\n{GREEN}[Mode switched to BALANCED Traffic]{RESET}")
                elif cmd == "a":
                    self.sim_mode = "AUTO"
                    print(f"\n{CYAN}[Mode switched to AUTO Dynamic Traffic]{RESET}")
                elif cmd == "q":
                    self.running = False
                    break
            except Exception:
                break


def main():
    parser = argparse.ArgumentParser(description="Smart Traffic Light Synthetic Data Simulator")
    parser.add_argument("--broker", default=DEFAULT_BROKER, help=f"MQTT broker hostname (default: {DEFAULT_BROKER})")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"MQTT broker port (default: {DEFAULT_PORT})")
    parser.add_argument("--prefix", default=DEFAULT_TOPIC_PREFIX, help=f"MQTT topic prefix (default: {DEFAULT_TOPIC_PREFIX})")
    parser.add_argument("--interval", type=float, default=2.0, help="Publishing interval in seconds (default: 2.0)")

    args = parser.parse_args()
    sim = TrafficSimulator(broker=args.broker, port=args.port, prefix=args.prefix, interval=args.interval)
    sim.run()


if __name__ == "__main__":
    main()
