export const PYTHON_CODE = `
import cv2
import numpy as np
import serial
import time
from tensorflow.keras.models import load_model
from datetime import datetime

# --- CONFIGURATION ---
MODEL_PATH = 'pill_classifier_model.h5'
SERIAL_PORT = 'COM3'  # Update to your Arduino port (e.g., /dev/ttyUSB0 on Linux)
BAUD_RATE = 9600
LABELS = ['Aspirin', 'Paracetamol', 'Vitamin C', 'Unknown']

# Medication Schedule: { 'Pill Name': 'HH:MM' }
SCHEDULE = {
    'Aspirin': '10:00',
    'Paracetamol': '14:00',
    'Vitamin C': '08:00'
}

# --- INITIALIZATION ---
try:
    model = load_model(MODEL_PATH)
    print("AI Model loaded successfully.")
except Exception as e:
    print(f"Error loading model: {e}")
    exit()

try:
    ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=1)
    time.sleep(2) # Wait for connection
    print(f"Connected to Arduino on {SERIAL_PORT}")
except Exception as e:
    print(f"Serial Error: {e}. Running in simulation mode.")
    ser = None

cap = cv2.VideoCapture(0)
if not cap.isOpened():
    print("Error: Could not open webcam.")
    exit()

def preprocess_image(frame):
    # Resize to match model input (e.g., 224x224)
    img = cv2.resize(frame, (224, 224))
    img = img.astype('float32') / 255.0
    img = np.expand_dims(img, axis=0)
    return img

print("AI Pillbox System Active. Press 'q' to quit.")

while True:
    ret, frame = cap.read()
    if not ret: break

    # 1. Preprocessing
    processed_img = preprocess_image(frame)

    # 2. Inference
    prediction = model.predict(processed_img)
    class_idx = np.argmax(prediction)
    pill_name = LABELS[class_idx]
    confidence = prediction[0][class_idx]

    # 3. Check Schedule
    current_time = datetime.now().strftime("%H:%M")
    
    # Display info on screen
    cv2.putText(frame, f"Pill: {pill_name} ({confidence:.2f})", (10, 30), 
                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
    cv2.putText(frame, f"Time: {current_time}", (10, 60), 
                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 1)

    # 4. Hardware Bridge (Serial Communication)
    if confidence > 0.8:
        if pill_name in SCHEDULE and SCHEDULE[pill_name] == current_time:
            print(f"MATCH FOUND: Dispensing {pill_name}")
            if ser:
                # Send '1' for Slot 1, '2' for Slot 2, etc.
                command = str(class_idx + 1).encode()
                ser.write(command)
            time.sleep(60) # Prevent multiple triggers in the same minute

    cv2.imshow('AI Pillbox Monitor', frame)

    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

cap.release()
cv2.destroyAllWindows()
if ser: ser.close()
`;

export const ARDUINO_CODE = `
/*
 * AI Pillbox Hardware Controller
 * Listens for Serial commands from Python Backend
 */

const int slot1LED = 8;
const int slot2LED = 9;
const int buzzer = 10;
const int resetButton = 2;

bool alarmActive = false;
int activeSlot = 0;

void setup() {
  Serial.begin(9600);
  pinMode(slot1LED, OUTPUT);
  pinMode(slot2LED, OUTPUT);
  pinMode(buzzer, OUTPUT);
  pinMode(resetButton, INPUT_PULLUP);
  
  Serial.println("Pillbox Ready.");
}

void loop() {
  // 1. Check for incoming Serial data
  if (Serial.available() > 0) {
    char command = Serial.read();
    
    if (command == '1') {
      triggerAlarm(1);
    } else if (command == '2') {
      triggerAlarm(2);
    }
  }

  // 2. Alarm Logic (Blinking)
  if (alarmActive) {
    int ledPin = (activeSlot == 1) ? slot1LED : slot2LED;
    
    digitalWrite(ledPin, HIGH);
    tone(buzzer, 1000); // Sound buzzer
    delay(200);
    digitalWrite(ledPin, LOW);
    noTone(buzzer);
    delay(200);
  }

  // 3. Reset Button Logic
  if (digitalRead(resetButton) == LOW) {
    stopAlarm();
  }
}

void triggerAlarm(int slot) {
  alarmActive = true;
  activeSlot = slot;
  Serial.print("Alarm triggered for Slot: ");
  Serial.println(slot);
}

void stopAlarm() {
  alarmActive = false;
  digitalWrite(slot1LED, LOW);
  digitalWrite(slot2LED, LOW);
  noTone(buzzer);
  Serial.println("Alarm Reset by User.");
}
`;
