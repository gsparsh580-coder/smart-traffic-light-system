/**
 * ============================================================================
 * Smart Traffic Light Control System - ESP32 Firmware
 * ============================================================================
 * Hardware: ESP32 DevKit V1
 * Sensors: HC-SR04 Ultrasonic Sensors (or IR proximity sensors)
 * Actuators: 4x Traffic Light LEDs (Red, Yellow, Green)
 * Connectivity: WiFi + HiveMQ MQTT Broker
 *
 * Capabilities:
 *  - Real-time vehicle density detection (Distance to vehicle queue)
 *  - HiveMQ MQTT telemetry streaming (lane density & emergency trigger)
 *  - Remote actuation from Node-RED / Web Dashboard
 *  - Offline Autonomous Safe Failsafe if network drops
 * ============================================================================
 */

#include <WiFi.h>
#include <PubSubClient.h>

// Fallback configuration if secrets.h is not present
#if __has_include("secrets.h")
  #include "secrets.h"
#else
  const char* WIFI_SSID         = "YOUR_WIFI_SSID";
  const char* WIFI_PASSWORD     = "YOUR_WIFI_PASSWORD";
  const char* MQTT_BROKER       = "broker.hivemq.com";
  const int   MQTT_PORT         = 1883;
  const char* MQTT_USER         = "";
  const char* MQTT_PASSWORD     = "";
  const char* MQTT_TOPIC_PREFIX = "smart_traffic/demo";
#endif

// ============================================================================
// HARDWARE PIN DEFINITIONS (ESP32 DevKit V1)
// ============================================================================

// Number of controlled intersection lanes (2 for compact demo, 4 for full 4-way)
#define NUM_LANES 4

// Ultrasonic Sensor Pins (Trig & Echo)
const int TRIG_PINS[NUM_LANES] = { 5, 19, 22, 25 };
const int ECHO_PINS[NUM_LANES] = { 18, 21, 23, 26 };

// Traffic Light LED Pins (Red, Yellow, Green for each Lane)
const int LED_RED[NUM_LANES]    = { 13, 27, 15, 16 };
const int LED_YELLOW[NUM_LANES] = { 12, 33,  2, 17 };
const int LED_GREEN[NUM_LANES]  = { 14, 32,  4,  5 };

// Emergency / Pedestrian Push Button Pin (Internal Pullup)
const int EMERGENCY_BUTTON_PIN = 34;

// Onboard Status LED (Blinks on MQTT activity)
const int STATUS_LED = 2;

// ============================================================================
// STATE VARIABLES & OBJECTS
// ============================================================================
WiFiClient espClient;
PubSubClient mqttClient(espClient);

// Lane States
enum LightState { LIGHT_RED, LIGHT_YELLOW, LIGHT_GREEN };
LightState laneLights[NUM_LANES] = { LIGHT_GREEN, LIGHT_RED, LIGHT_RED, LIGHT_RED };

int laneDistances[NUM_LANES] = { 100, 100, 100, 100 }; // in cm
int laneVehicles[NUM_LANES]  = { 0, 0, 0, 0 };

unsigned long lastSensorPublishTime = 0;
const unsigned long SENSOR_PUBLISH_INTERVAL = 1500; // ms

unsigned long lastEmergencyDebounce = 0;
bool emergencyActive = false;

// Offline Autonomous Fallback Timing
bool offlineMode = false;
unsigned long lastOfflineCycleTime = 0;
int offlineActiveLane = 0;
int offlinePhase = 0; // 0=Green, 1=Yellow

// ============================================================================
// HELPER: ULTRASONIC SENSOR MEASUREMENT
// ============================================================================
int measureDistanceCm(int trigPin, int echoPin) {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);

  // Measure pulse duration (timeout 25ms ~ 4.3 meters max)
  long duration = pulseIn(echoPin, HIGH, 25000);
  if (duration <= 0) {
    return 150; // No obstacle / empty road default
  }

  int distanceCm = duration * 0.034 / 2;
  return constrain(distanceCm, 2, 150);
}

// Convert distance in cm to estimated vehicle queue count
// Closer vehicles = shorter distance = higher density
int distanceToVehicleCount(int distanceCm) {
  if (distanceCm < 10) return 18; // Heavy queue right at stop line
  if (distanceCm < 25) return 12;
  if (distanceCm < 45) return 7;
  if (distanceCm < 70) return 3;
  if (distanceCm < 100) return 1;
  return 0; // Clear road
}

// ============================================================================
// HARDWARE ACTUATION: LED CONTROL
// ============================================================================
void updateLaneLED(int laneIdx, LightState state) {
  laneLights[laneIdx] = state;

  digitalWrite(LED_RED[laneIdx],    state == LIGHT_RED    ? HIGH : LOW);
  digitalWrite(LED_YELLOW[laneIdx], state == LIGHT_YELLOW ? HIGH : LOW);
  digitalWrite(LED_GREEN[laneIdx],  state == LIGHT_GREEN  ? HIGH : LOW);
}

void applyLightStateString(int laneIdx, const String& stateStr) {
  if (laneIdx < 0 || laneIdx >= NUM_LANES) return;

  if (stateStr.equalsIgnoreCase("GREEN")) {
    updateLaneLED(laneIdx, LIGHT_GREEN);
  } else if (stateStr.equalsIgnoreCase("YELLOW")) {
    updateLaneLED(laneIdx, LIGHT_YELLOW);
  } else {
    updateLaneLED(laneIdx, LIGHT_RED);
  }
}

// ============================================================================
// MQTT CALLBACK: REMOTE CONTROLLER COMMANDS
// ============================================================================
void onMqttMessage(char* topic, byte* payload, unsigned int length) {
  String message = "";
  for (unsigned int i = 0; i < length; i++) {
    message += (char)payload[i];
  }
  message.trim();

  Serial.printf("[MQTT RX] %s -> %s\n", topic, message.c_str());

  // Individual lane light topics: <prefix>/lane1/light
  for (int i = 0; i < NUM_LANES; i++) {
    char expectedTopic[80];
    snprintf(expectedTopic, sizeof(expectedTopic), "%s/lane%d/light", MQTT_TOPIC_PREFIX, i + 1);
    if (strcmp(topic, expectedTopic) == 0) {
      applyLightStateString(i, message);
      return;
    }
  }

  // Master light control JSON topic: <prefix>/control/lights
  char masterTopic[80];
  snprintf(masterTopic, sizeof(masterTopic), "%s/control/lights", MQTT_TOPIC_PREFIX);
  if (strcmp(topic, masterTopic) == 0) {
    // Quick parse for light states in JSON without heavy library dependencies
    for (int i = 0; i < NUM_LANES; i++) {
      char key[20];
      snprintf(key, sizeof(key), "\"lane%d\":\"", i + 1);
      int idx = message.indexOf(key);
      if (idx != -1) {
        idx += strlen(key);
        int endQuote = message.indexOf("\"", idx);
        if (endQuote != -1) {
          String val = message.substring(idx, endQuote);
          applyLightStateString(i, val);
        }
      }
    }
  }

  // Emergency override notification: <prefix>/control/emergency
  char emergTopic[80];
  snprintf(emergTopic, sizeof(emergTopic), "%s/control/emergency", MQTT_TOPIC_PREFIX);
  if (strcmp(topic, emergTopic) == 0) {
    if (message.indexOf("OVERRIDE") != -1) {
      emergencyActive = true;
      Serial.println("[!] Emergency Override Active from MQTT!");
    } else if (message.indexOf("CLEAR") != -1) {
      emergencyActive = false;
      Serial.println("[✓] Emergency Cleared.");
    }
  }
}

// ============================================================================
// WIFI & MQTT CONNECTION MANAGEMENT
// ============================================================================
void setupWiFi() {
  Serial.printf("Connecting to WiFi: %s", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 25) {
    delay(400);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[✓] WiFi Connected!");
    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n[✗] WiFi Connection Failed. Entering Autonomous Offline Mode.");
    offlineMode = true;
  }
}

void reconnectMqtt() {
  if (WiFi.status() != WL_CONNECTED) return;

  while (!mqttClient.connected()) {
    Serial.printf("Connecting to HiveMQ (%s:%d)... ", MQTT_BROKER, MQTT_PORT);
    String clientId = "ESP32_TrafficNode_" + String(random(0xffff), HEX);

    bool connected = false;
    if (strlen(MQTT_USER) > 0) {
      connected = mqttClient.connect(clientId.c_str(), MQTT_USER, MQTT_PASSWORD);
    } else {
      connected = mqttClient.connect(clientId.c_str());
    }

    if (connected) {
      Serial.println("[✓] HiveMQ Connected!");
      offlineMode = false;

      // Publish Device Online Announcement
      char statusTopic[80];
      snprintf(statusTopic, sizeof(statusTopic), "%s/system/status", MQTT_TOPIC_PREFIX);
      mqttClient.publish(statusTopic, "{\"device\":\"ESP32\",\"status\":\"ONLINE\",\"mode\":\"REAL_ESP32\"}", true);

      // Subscribe to control topics
      char subPattern[80];
      snprintf(subPattern, sizeof(subPattern), "%s/control/#", MQTT_TOPIC_PREFIX);
      mqttClient.subscribe(subPattern);

      for (int i = 0; i < NUM_LANES; i++) {
        char lightSub[80];
        snprintf(lightSub, sizeof(lightSub), "%s/lane%d/light", MQTT_TOPIC_PREFIX, i + 1);
        mqttClient.subscribe(lightSub);
      }
    } else {
      Serial.printf("[✗] MQTT failed (rc=%d). Retrying in 4s...\n", mqttClient.state());
      delay(4000);
      break; // Let main loop run to keep offline lights cycling
    }
  }
}

// ============================================================================
// OFFLINE AUTONOMOUS SAFE CYCLE
// ============================================================================
void runOfflineFailsafeCycle() {
  unsigned long now = millis();
  unsigned long elapsed = now - lastOfflineCycleTime;

  if (offlinePhase == 0) {
    // Green Phase (10 seconds)
    if (elapsed >= 10000) {
      offlinePhase = 1;
      lastOfflineCycleTime = now;
      updateLaneLED(offlineActiveLane, LIGHT_YELLOW);
    }
  } else if (offlinePhase == 1) {
    // Yellow Phase (3 seconds) -> Transition to next lane
    if (elapsed >= 3000) {
      updateLaneLED(offlineActiveLane, LIGHT_RED);
      offlineActiveLane = (offlineActiveLane + 1) % NUM_LANES;
      offlinePhase = 0;
      lastOfflineCycleTime = now;
      updateLaneLED(offlineActiveLane, LIGHT_GREEN);
    }
  }
}

// ============================================================================
// ARDUINO SETUP & LOOP
// ============================================================================
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n==============================================");
  Serial.println("  ESP32 Smart Traffic Light Controller Start  ");
  Serial.println("==============================================");

  // Initialize Pins
  pinMode(STATUS_LED, OUTPUT);
  pinMode(EMERGENCY_BUTTON_PIN, INPUT_PULLUP);

  for (int i = 0; i < NUM_LANES; i++) {
    pinMode(TRIG_PINS[i], OUTPUT);
    pinMode(ECHO_PINS[i], INPUT);
    digitalWrite(TRIG_PINS[i], LOW);

    pinMode(LED_RED[i], OUTPUT);
    pinMode(LED_YELLOW[i], OUTPUT);
    pinMode(LED_GREEN[i], OUTPUT);

    // Initial safe state: Lane 1 Green, other lanes Red
    updateLaneLED(i, (i == 0) ? LIGHT_GREEN : LIGHT_RED);
  }

  // Initialize Network & MQTT
  setupWiFi();
  mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
  mqttClient.setCallback(onMqttMessage);
  mqttClient.setBufferSize(512);

  lastOfflineCycleTime = millis();
}

void loop() {
  // Check MQTT Connection
  if (!mqttClient.connected()) {
    reconnectMqtt();
    if (!mqttClient.connected()) {
      runOfflineFailsafeCycle();
    }
  } else {
    mqttClient.loop();
  }

  // 1. Read Emergency Push Button
  if (digitalRead(EMERGENCY_BUTTON_PIN) == LOW) {
    if (millis() - lastEmergencyDebounce > 1000) {
      lastEmergencyDebounce = millis();
      emergencyActive = !emergencyActive;
      Serial.printf("[BUTTON] Emergency Trigger Toggled: %s\n", emergencyActive ? "ACTIVE" : "CLEARED");

      char emergTopic[80];
      snprintf(emergTopic, sizeof(emergTopic), "%s/control/emergency", MQTT_TOPIC_PREFIX);
      char payload[100];
      snprintf(payload, sizeof(payload), "{\"action\":\"%s\",\"lane\":1,\"source\":\"ESP32_BUTTON\"}",
               emergencyActive ? "OVERRIDE" : "CLEAR");
      mqttClient.publish(emergTopic, payload);
    }
  }

  // 2. Periodic Sensor Polling & HiveMQ Telemetry Publishing
  unsigned long now = millis();
  if (now - lastSensorPublishTime >= SENSOR_PUBLISH_INTERVAL) {
    lastSensorPublishTime = now;

    for (int i = 0; i < NUM_LANES; i++) {
      int dist = measureDistanceCm(TRIG_PINS[i], ECHO_PINS[i]);
      laneDistances[i] = dist;
      laneVehicles[i]  = distanceToVehicleCount(dist);

      if (mqttClient.connected()) {
        char topic[80];
        snprintf(topic, sizeof(topic), "%s/lane%d/density", MQTT_TOPIC_PREFIX, i + 1);

        char payload[140];
        snprintf(payload, sizeof(payload),
                 "{\"lane\":%d,\"distance_cm\":%d,\"vehicle_count\":%d,\"source\":\"ESP32_REAL\"}",
                 i + 1, dist, laneVehicles[i]);

        mqttClient.publish(topic, payload);
      }
    }

    // Toggle Status LED pulse
    digitalWrite(STATUS_LED, !digitalRead(STATUS_LED));
  }
}
