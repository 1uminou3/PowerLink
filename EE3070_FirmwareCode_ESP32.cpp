#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SH1106.h>
#include "DFRobot_INA219.h"
#include <WiFi.h>
#include <SPI.h>
#include <MFRC522.h>
#include <Firebase_ESP_Client.h>
#include "addons/TokenHelper.h"
#include "addons/RTDBHelper.h"
#include <time.h>
#include <HTTPClient.h>
#include <WiFiClient.h>
#include <UrlEncode.h>

//Pins
#define OLED_RESET -1
#define button 14
#define ALERT_DURATION 10000 
#define DISTANCE_THRESHOLD 10.0 

const char* ssid = "Will.";
const char* pass = "95348531";
#define API_KEY "AIzaSyB-MtbsHu9_dEGQkEo3Y46rxgIeg5vhfR8"
#define DATABASE_URL "https://fir-a5ed4-default-rtdb.firebaseio.com/"

#define TRIG_PIN 32
#define ECHO_PIN 35
#define BUZZER_PIN 27 
#define HALL_EFFECT_PIN 15

#define RFID_SS_PIN 5
#define RFID_RST_PIN 4 
#define LOCK_PIN 13 

String phoneNumber = "+85295348531";
String apiKey = "6724075";

byte authorizedUID[] = {0x63, 0x50, 0x2A, 0x39}; 

//RTOS
SemaphoreHandle_t dataMutex;
QueueHandle_t networkQueue;

// Network Queue Message Types
enum NetMessageType {
  MSG_FIREBASE_ROUTINE,
  MSG_ALERT_SUSPICIOUS,
  MSG_RFID_UPLOAD
};

// Global Shared Variables (Protected by dataMutex)
int displayMode = 0;
float eBusVoltage = 0, eCurrent = 0, eTotalPower = 0;
float sBusVoltage = 0, sCurrent = 0, sTotalPower = 0;

//Display
class DisplayManager {
private:
  Adafruit_SH1106 display;
public:
  DisplayManager() : display(OLED_RESET) {}
  void init() {
    display.begin(SH1106_SWITCHCAPVCC, 0x3C);
    display.setTextColor(WHITE);
    display.setTextSize(1.7);
    display.clearDisplay();
  }
  void clear() { display.clearDisplay(); }
  void update() { display.display(); }
  void printText(int x, int y, const String& text, float value = -1, const String& unit = "") {
    display.setCursor(x, y);
    display.println(text);
    if (value != -1) {
      display.setCursor(x + text.length() * 6, y);
      display.print(value, 2);
      if (!unit.isEmpty()) {
        display.print(" ");
        display.print(unit);
      }
    }
  }
};
DisplayManager displayManager;

//Sensor
class SensorManager {
private:
  DFRobot_INA219_IIC electricity;
  DFRobot_INA219_IIC solarPanel;
  float EtotalPower_Wh = 0;
  float StotalPower_Wh = 0;

public:
  SensorManager() 
    : electricity(&Wire, INA219_I2C_ADDRESS4),
      solarPanel(&Wire, INA219_I2C_ADDRESS1) {}

  void init() {
    while (!electricity.begin() || !solarPanel.begin()) {
      Serial.println("INA219 begin failed");
      vTaskDelay(pdMS_TO_TICKS(200));
    }
    electricity.linearCalibrate(813.0, 784.0);
    solarPanel.linearCalibrate(1000, 1000);
  }

  void updatePower() {
    float EcurrentPower_W = electricity.getPower_mW() / 1000;
    float ScurrentPower_W = solarPanel.getPower_mW() / 1000;
    EtotalPower_Wh += EcurrentPower_W / 3600;
    StotalPower_Wh += ScurrentPower_W / 3600;


    if (xSemaphoreTake(dataMutex, portMAX_DELAY)) {
      eBusVoltage = electricity.getBusVoltage_V();
      eCurrent = electricity.getCurrent_mA();
      eTotalPower = EtotalPower_Wh;
      sBusVoltage = solarPanel.getBusVoltage_V();
      sCurrent = solarPanel.getCurrent_mA();
      sTotalPower = StotalPower_Wh;
      xSemaphoreGive(dataMutex);
    }
  }
};
SensorManager sensorManager;

// --- Ultrasonic System ---
class AlertSystem {
private:
  int trigPin, echoPin, buzzerPin;
  unsigned long startTime;
  bool isWithinRange;

public:
  AlertSystem(int trig, int echo, int buzzer)
    : trigPin(trig), echoPin(echo), buzzerPin(buzzer), startTime(0), isWithinRange(false) {}

  void init() {
    pinMode(trigPin, OUTPUT);
    pinMode(echoPin, INPUT);
    pinMode(buzzerPin, OUTPUT);
    digitalWrite(buzzerPin, LOW);
  }

  float readDistance() {
    digitalWrite(trigPin, LOW);
    delayMicroseconds(2);
    digitalWrite(trigPin, HIGH);
    delayMicroseconds(10);
    digitalWrite(trigPin, LOW);
    long duration = pulseIn(echoPin, HIGH, 30000); 
    return (duration * 0.034) / 2;
  }

  void monitor() {
    bool door_locked = digitalRead(HALL_EFFECT_PIN);
    float distance = readDistance();
    
    if (distance > 0 && distance < DISTANCE_THRESHOLD) {
      if (!isWithinRange) {
        isWithinRange = true;
        startTime = millis();
      } else {
        if ((millis() - startTime >= ALERT_DURATION) && !door_locked) {
          digitalWrite(buzzerPin, HIGH);
          // Queue network alert instead of blocking
          NetMessageType msg = MSG_ALERT_SUSPICIOUS;
          xQueueSend(networkQueue, &msg, 0);
          vTaskDelay(pdMS_TO_TICKS(1000)); // Prevent queue flooding
        }
      }
    } else {
      isWithinRange = false;
      digitalWrite(buzzerPin, LOW);
    }
  }
};
AlertSystem alertSystem(TRIG_PIN, ECHO_PIN, BUZZER_PIN);

//Firebase
class NetworkMonitor {
private:
  FirebaseData firebaseData;
  FirebaseConfig config;
  FirebaseAuth auth;

public:
  void init() {
    configTime(3600, 3600, "pool.ntp.org");
    config.api_key = API_KEY;
    config.database_url = DATABASE_URL;
    auth.user.email = "test@gmail.com";
    auth.user.password = "12345678";
    Firebase.signUp(&config, &auth, "", "");
    config.token_status_callback = tokenStatusCallback;
    Firebase.begin(&config, &auth);
    Firebase.reconnectWiFi(true);
  }

  void uploadRoutineData() {
    float l_eBusVolt, l_eCurr, l_sBusVolt, l_sCurr, l_eTotal, l_sTotal;
    if (xSemaphoreTake(dataMutex, portMAX_DELAY)) {
      l_eBusVolt = eBusVoltage; l_eCurr = eCurrent; l_eTotal = eTotalPower;
      l_sBusVolt = sBusVoltage; l_sCurr = sCurrent; l_sTotal = sTotalPower;
      xSemaphoreGive(dataMutex);
    }

    time_t now = time(nullptr);
    String uniqueKey = String(now);
    String uid = auth.token.uid.c_str();
    FirebaseJson json;
    
    json.set("timestamp", now);
    json.set("value", l_eBusVolt * (1 + 1.2 / (l_eBusVolt + 0.01)));
    Firebase.RTDB.setJSON(&firebaseData, "users/" + uid + "/data/Electricity_transmission_(Voltage)/" + uniqueKey, &json);
    json.set("value", l_eCurr);
    Firebase.RTDB.setJSON(&firebaseData, "users/" + uid + "/data/Electricity_transmission_(Current)/" + uniqueKey, &json);
    json.set("value", l_sBusVolt);
    Firebase.RTDB.setJSON(&firebaseData, "users/" + uid + "/data/SolarPanel_(Voltage)/" + uniqueKey, &json);
    json.set("value", l_sCurr);
    Firebase.RTDB.setJSON(&firebaseData, "users/" + uid + "/data/SolarPanel_(Current)/" + uniqueKey, &json);
    
    Firebase.RTDB.setInt(&firebaseData, "users/" + uid + "/data/Power_Usage_(Wh)/timestamp", now);
    Firebase.RTDB.setFloat(&firebaseData, "users/" + uid + "/data/Power_Usage_(Wh)/value", l_eTotal);
    Firebase.RTDB.setInt(&firebaseData, "users/" + uid + "/data/Charge_Amount_(Wh)/timestamp", now);
    Firebase.RTDB.setFloat(&firebaseData, "users/" + uid + "/data/Charge_Amount_(Wh)/value", l_sTotal);
  }

  void uploadRFID() {
    time_t now = time(nullptr);
    String uid = auth.token.uid.c_str();
    FirebaseJson json;
    json.set("timestamp", now);
    
    String hexStr = ""; char temp[3];
    for (int i = 0; i < sizeof(authorizedUID); i++) {
      sprintf(temp, "%02X", authorizedUID[i]);
      hexStr += temp;
    }
    json.set("StaffNo", hexStr);
    Firebase.RTDB.setJSON(&firebaseData, "users/" + uid + "/RFID/" + String(now), &json);
  }

  void sendAlert() {
    time_t now = time(nullptr);
    String uid = auth.token.uid.c_str();
    FirebaseJson json;
    json.set("timestamp", now);
    json.set("value", "unauthorized");
    Firebase.RTDB.setJSON(&firebaseData, "users/" + uid + "/RFID/" + String(now), &json);

    String url = "http://api.callmebot.com/whatsapp.php?phone=" + phoneNumber + "&apikey=" + apiKey + "&text=" + urlEncode("Alert! Suspicious Notification");
    WiFiClient client;    
    HTTPClient http;
    http.begin(client, url);
    http.addHeader("Content-Type", "application/x-www-form-urlencoded");
    http.POST(url);
    http.end();
  }
};
NetworkMonitor netMonitor;

//RFID Lock System
class RFID_Lock {
public:
  MFRC522 rfid;
  int buzzerPin;
  RFID_Lock(int ssPin, int rstPin, int lockPin, int buzzerPin)
    : rfid(ssPin, rstPin), buzzerPin(buzzerPin) {}

  void begin() {
    SPI.begin(18, 19, 23, RFID_SS_PIN);
    rfid.PCD_Init();
    pinMode(buzzerPin, OUTPUT);
    digitalWrite(LOCK_PIN, LOW);
  }

  void checkReader() {
    if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) return;

    bool matched = true;
    if (rfid.uid.size != sizeof(authorizedUID)) matched = false;
    for (byte i = 0; i < rfid.uid.size; i++) {
      if (authorizedUID[i] != rfid.uid.uidByte[i]) matched = false;
    }

    if (matched) {
      Serial.println("Matched! Unlocking");
      digitalWrite(LOCK_PIN, HIGH);
      
      // Queue RFID upload
      NetMessageType msg = MSG_RFID_UPLOAD;
      xQueueSend(networkQueue, &msg, 0);

      // RTOS Non-blocking delay
      vTaskDelay(pdMS_TO_TICKS(5000));
      
      digitalWrite(LOCK_PIN, LOW);
      Serial.println("Locked again.");
    } else {
      Serial.println("Invalid card!");
      digitalWrite(buzzerPin, HIGH);
      
      NetMessageType msg = MSG_ALERT_SUSPICIOUS;
      xQueueSend(networkQueue, &msg, 0);
      
      vTaskDelay(pdMS_TO_TICKS(2000));
      digitalWrite(buzzerPin, LOW);
    }
    rfid.PICC_HaltA();
  }
};
RFID_Lock rfidLock(RFID_SS_PIN, RFID_RST_PIN, LOCK_PIN, BUZZER_PIN);

//FreeRTOS
void TaskSensors(void *pvParameters) {
  for (;;) {
    sensorManager.updatePower();
    alertSystem.monitor();

    // Button debounce and state tracking
    static bool lastButtonState = LOW;
    bool currentButtonState = digitalRead(button);
    if (currentButtonState == HIGH && lastButtonState == LOW) {
      if (xSemaphoreTake(dataMutex, portMAX_DELAY)) {
        displayMode = (displayMode + 1) % 3;
        xSemaphoreGive(dataMutex);
      }
    }
    lastButtonState = currentButtonState;
    
    vTaskDelay(pdMS_TO_TICKS(100)); // Run every 100ms
  }
}

void TaskRFID(void *pvParameters) {
  for (;;) {
    rfidLock.checkReader();
    vTaskDelay(pdMS_TO_TICKS(200)); // Poll RFID 5 times a second
  }
}

void TaskDisplay(void *pvParameters) {
  for (;;) {
    float l_eBusVolt, l_eCurr, l_eTotal, l_sBusVolt, l_sCurr, l_sTotal;
    int localMode;

    if (xSemaphoreTake(dataMutex, portMAX_DELAY)) {
      l_eBusVolt = eBusVoltage; l_eCurr = eCurrent; l_eTotal = eTotalPower;
      l_sBusVolt = sBusVoltage; l_sCurr = sCurrent; l_sTotal = sTotalPower;
      localMode = displayMode;
      xSemaphoreGive(dataMutex);
    }

    displayManager.clear();
    if (localMode == 0) {
      displayManager.printText(0, 0, "Transmission:");
      displayManager.printText(82, 0, "", l_eBusVolt * (1 + 1.2 / (l_eBusVolt + 0.01)), "V");
      displayManager.printText(0, 24, "Current:");
      displayManager.printText(52, 24, "", l_eCurr, "mA");
      displayManager.printText(0, 48, "Power Usage:");
      displayManager.printText(76, 48, "", l_eTotal, "Wh");
    } else if (localMode == 1) {
      displayManager.printText(0, 0, "SolarPanel:");
      displayManager.printText(69, 0, "", l_sBusVolt, "V");
      displayManager.printText(0, 24, "Current:");
      displayManager.printText(52, 24, "", l_sCurr, "mA");
      displayManager.printText(0, 48, "Charge Amt:");
      displayManager.printText(70, 48, "", l_sTotal, "Wh");
    }
    displayManager.update();

    vTaskDelay(pdMS_TO_TICKS(1000)); 
  }
}

void TaskNetwork(void *pvParameters) {
  netMonitor.init();
  unsigned long lastRoutineUpload = millis();

  for (;;) {
    NetMessageType incomingMsg;
    if (xQueueReceive(networkQueue, &incomingMsg, 0)) {
      if (incomingMsg == MSG_ALERT_SUSPICIOUS) {
        netMonitor.sendAlert();
      } else if (incomingMsg == MSG_RFID_UPLOAD) {
        netMonitor.uploadRFID();
      }
    }
    if (millis() - lastRoutineUpload >= 10000) {
      netMonitor.uploadRoutineData();
      lastRoutineUpload = millis();
    }

    vTaskDelay(pdMS_TO_TICKS(500));
  }
}

//Setup
void setup() {
  Serial.begin(115200);
  dataMutex = xSemaphoreCreateMutex();
  networkQueue = xQueueCreate(10, sizeof(NetMessageType));
  pinMode(LOCK_PIN, OUTPUT);
  pinMode(HALL_EFFECT_PIN, INPUT);
  pinMode(button, INPUT_PULLDOWN);
  WiFi.begin(ssid, pass);
  Serial.print("Connecting to Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500); Serial.print(".");
  }
  Serial.println("\nConnected!");
  displayManager.init();
  sensorManager.init();
  alertSystem.init();
  rfidLock.begin();

  //Create RTOS Tasks
  xTaskCreatePinnedToCore(TaskSensors, "Sensors", 4096, NULL, 2, NULL, 1);
  xTaskCreatePinnedToCore(TaskRFID, "RFID", 4096, NULL, 2, NULL, 1);
  xTaskCreatePinnedToCore(TaskDisplay, "Display", 4096, NULL, 1, NULL, 1);
  xTaskCreatePinnedToCore(TaskNetwork, "Network", 8192, NULL, 1, NULL, 0); 
}

void loop() {
  vTaskDelete(NULL);
}