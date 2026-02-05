/*
 * ESP32-S3 HID Touchscreen Firmware (Robust Version)
 * -----------------------------------------------------------------
 * This firmware receives HID touch reports via Serial (UART) and forwards
 * them to the connected host (Android/PC) via Native USB HID.
 *
 * Key Features:
 * - Robust Serial Reading: Timeouts preventing infinite blocking.
 * - Visual Feedback: Blinks onboard LED on data reception.
 * - Diagnostics: Prints heartbeat and status messages to Serial.
 * - Safety: Watchdog-style reset if USB hangs (optional, kept simple here).
 *
 * WIRING:
 * - Native USB (pins 19/20) -> Connect to Phone (OTG).
 * - UART0 (TX/RX) -> Connect to PC (Windows Sender).
 *
 * CONFIGURATION:
 * - Select "ESP32S3 Dev Module" in Arduino IDE.
 * - USB CDC On Boot: "Disabled" (CRITICAL! Ensures Serial maps to UART0).
 * - USB Mode: "Hardware CDC and JTAG".
 */

#include "USB.h"
#include "USBHID.h"
#include <string.h>
#include <Preferences.h>
#include "mbedtls/sha256.h"

// --- Security Configuration ---
// 取消注释下方宏定义以启用设备绑定功能
// #define ENABLE_DEVICE_BINDING 
#define SECRET_SALT "" // 必须与生成器保持一致

Preferences preferences;
bool isAuthorized = false;

// --- Configuration ---
#ifndef LED_BUILTIN
#define LED_BUILTIN 2        // Fallback if not defined by board variant
#endif
#define LED_PIN LED_BUILTIN  // Use board's default LED
#define SERIAL_BAUD 921600   // Increased to 921600 for high speed transmission
#define SERIAL_TIMEOUT_MS 5  // Reduced timeout

// --- Constants ---
#define MAGIC_HEADER 0xF4
#define CMD_OTHER 0x03
#define SERIAL_BUFFER_SIZE 11 // Body size (excluding header)

// --- HID Descriptor ---
USBHID HID;

static uint8_t report_descriptor[] = {
    0x05, 0x0D, // Usage Page (Digitizer)
    0x09, 0x04, // Usage (Touch Screen)
    0xA1, 0x01, // Collection (Application)
    // Finger 1
    0x09, 0x22, //   Usage (Finger)
    0xA1, 0x02, //   Collection (Logical)
    0x09, 0x42, //     Usage (Tip Switch)
    0x15, 0x00, //     Logical Minimum (0)
    0x25, 0x01, //     Logical Maximum (1)
    0x75, 0x01, //     Report Size (1)
    0x95, 0x01, //     Report Count (1)
    0x81, 0x02, //     Input (Data,Var,Abs)
    0x95, 0x07, //     Report Count (7) - padding to full byte
    0x81, 0x03, //     Input (Const,Var,Abs)
    0x09, 0x51, //     Usage (Contact Identifier)
    0x75, 0x08, //     Report Size (8)
    0x95, 0x01, //     Report Count (1)
    0x81, 0x02, //     Input (Data,Var,Abs)
    0x05, 0x01, //     Usage Page (Generic Desktop)
    // X
    0x09, 0x30,                             // Usage (X)
    0x15, 0x00,                             // Logical Minimum (0)
    0x27, 0xff, 0x7f, 0x00, 0x00,           // Logical Maximum (32767) - Still using 32-bit container
    0x75, 0x20,                             // Report Size (32) - Keep 32-bit for alignment/protocol compat
    0x95, 0x01,                             // Report Count (1)
    0x81, 0x02,                             // Input (Data,Var,Abs)
    // Y
    0x09, 0x31,                             // Usage (Y)
    0x15, 0x00,                             // Logical Minimum (0)
    0x27, 0xff, 0x7f, 0x00, 0x00,           // Logical Maximum (32767)
    0x75, 0x20,                             // Report Size (32)
    0x95, 0x01,
    0x81, 0x02,
    0xC0, //   End Collection
    // Contact Count
    0x05, 0x0D, // Usage Page (Digitizer)
    0x09, 0x54, // Usage (Contact Count)
    0x25, 0x10, // Logical Maximum (16) - Increased from 2 to support more fingers
    0x75, 0x08, // Report Size (8)
    0x95, 0x01, // Report Count (1)
    0x81, 0x02, // Input (Data,Var,Abs)
    0xC0        // End Collection (Application)
};

class CustomHIDDevice : public USBHIDDevice
{
public:
    CustomHIDDevice(void)
    {
        static bool initialized = false;
        if (!initialized)
        {
            initialized = true;
            HID.addDevice(this, sizeof(report_descriptor));
        }
    }

    uint16_t _onGetDescriptor(uint8_t *buffer)
    {
        memcpy(buffer, report_descriptor, sizeof(report_descriptor));
        return sizeof(report_descriptor);
    }

    void begin(void)
    {
        HID.begin();
    }

    bool send(uint8_t *value, uint16_t len)
    {
        return HID.SendReport(0, value, len);
    }
};

CustomHIDDevice *Device = nullptr;
static uint8_t serial_buffer[SERIAL_BUFFER_SIZE];
unsigned long lastHeartbeat = 0;

// --- Security Functions ---

String getMacAddress() {
    uint64_t chipid = ESP.getEfuseMac();
    char macStr[13];
    // MAC Address in hex format (e.g., AABBCCDDEEFF)
    sprintf(macStr, "%02X%02X%02X%02X%02X%02X", 
        (uint8_t)(chipid >> 40), (uint8_t)(chipid >> 32),
        (uint8_t)(chipid >> 24), (uint8_t)(chipid >> 16),
        (uint8_t)(chipid >> 8), (uint8_t)chipid);
    return String(macStr);
}

bool checkLicense() {
#ifndef ENABLE_DEVICE_BINDING
    return true; // 如果未开启绑定功能，默认总是通过
#endif

    preferences.begin("qine_auth", true); // Read-only mode
    String storedLicense = preferences.getString("license", "");
    preferences.end();

    if (storedLicense.length() == 0) {
        return false;
    }

    String mac = getMacAddress();
    String rawData = mac + SECRET_SALT;
    
    // Calculate SHA256
    byte shaResult[32];
    mbedtls_sha256_context ctx;
    mbedtls_sha256_init(&ctx);
    mbedtls_sha256_starts(&ctx, 0);
    mbedtls_sha256_update(&ctx, (const unsigned char*)rawData.c_str(), rawData.length());
    mbedtls_sha256_finish(&ctx, shaResult);
    mbedtls_sha256_free(&ctx);

    // Convert to Hex String (First 16 chars)
    String expectedLicense = "";
    for(int i=0; i<8; i++) { // 8 bytes = 16 hex chars
        if(shaResult[i] < 16) expectedLicense += "0";
        expectedLicense += String(shaResult[i], HEX);
    }
    expectedLicense.toUpperCase();

    return storedLicense.equals(expectedLicense);
}

void handleSerialCommand(String cmd) {
    cmd.trim();
    if (cmd.startsWith("ACTIVATE:")) {
        String newLicense = cmd.substring(9);
        newLicense.trim();
        newLicense.toUpperCase();
        
        preferences.begin("qine_auth", false); // Read-write
        preferences.putString("license", newLicense);
        preferences.end();
        
        Serial.println("INFO: License saved. Restarting device...");
        delay(1000);
        ESP.restart();
    } else if (cmd.equals("GET_MAC")) {
        Serial.println("MAC:" + getMacAddress());
    }
}

void initDevice()
{
    // Check Authorization first
    isAuthorized = checkLicense();
    if (!isAuthorized) {
        // Serial.begin(115200); // FIX: Keep using SERIAL_BAUD (921600) to match PC software
        // Wait for serial to be ready might not work if USB is not initialized, 
        // but we need USB to print message? 
        // Actually on ESP32S3 Native USB, Serial maps to CDC.
        // But if we block here, we might want to allow Serial commands via UART0 too.
        // Let's initialize USB CDC minimally or use UART0.
        // Assuming Serial is mapped to UART0 based on config comments.
        
        // We will initialize Serial in setup(), so here we just return if not authorized.
        // But we need to allow USB CDC to work for license input if user uses OTG port?
        // No, user guide says "UART0 -> Connect to PC".
        return; 
    }

    if (Device) delete Device;
    Device = new CustomHIDDevice();
    
    // --- 设备伪装 (Device Disguise) ---
    // 开源版已移除
    
    Device->begin();
    USB.begin();
    
    // Blink LED to indicate init start
    for(int i=0; i<5; i++) {
        digitalWrite(LED_PIN, HIGH); delay(50);
        digitalWrite(LED_PIN, LOW); delay(50);
    }

    unsigned long start = millis();
    while (!HID.ready() && (millis() - start < 3000)) {
        delay(10);
    }

    if (HID.ready()) {
        Serial.println("INFO: HID ready.");
        Serial.println("MAC:" + getMacAddress());
    } else {
        Serial.println("ERROR: HID initialization failed.");
    }
    Serial.println("INFO: System initialized. Waiting for serial data...");
}

void updateTouchState(uint8_t *data)
{
    if (Device && HID.ready()) {
        Device->send(data, SERIAL_BUFFER_SIZE);
    }
}

void setup()
{
    // 0. Safety delay to ensure power stability
    delay(1000);

    pinMode(LED_PIN, OUTPUT);
    // Blink fast 3 times at very beginning to show life
    for(int i=0; i<3; i++) { digitalWrite(LED_PIN, HIGH); delay(100); digitalWrite(LED_PIN, LOW); delay(100); }

    digitalWrite(LED_PIN, LOW); // Start OFF

    // IMPORTANT: Ensure Serial is mapped to UART0
    Serial.setRxBufferSize(4096); // Large buffer for high speed
    Serial.begin(SERIAL_BAUD);
    
    // Wait for Serial to initialize
    unsigned long serialStart = millis();
    while(!Serial && (millis() - serialStart < 2000)); 

    Serial.setTimeout(SERIAL_TIMEOUT_MS); // Non-blocking reads
    
    Serial.println("\n\n=== ESP32-S3 QInE Touch Firmware v3.2 (921600 Baud) ===");
    
    // 发送握手信号 (版本号)
    delay(100);
    Serial.println("HANDSHAKE:v3.2");
    
    initDevice();
}

void loop()
{
    // 0. Authorization Check Loop
    if (!isAuthorized) {
        // Slow blink to indicate unauthorized state
        digitalWrite(LED_PIN, HIGH); delay(500);
        digitalWrite(LED_PIN, LOW); delay(500);
        
        Serial.println("AUTH_REQUIRED MAC:" + getMacAddress());
        
        // Check for serial commands (ACTIVATE:XXXX)
        if (Serial.available()) {
            String line = Serial.readStringUntil('\n');
            handleSerialCommand(line);
        }
        return;
    }

    // 1. Read from Serial with timeout
    size_t bytesRead = Serial.readBytes(serial_buffer, 1);
    if (bytesRead == 0) {
        // Heartbeat / Diagnostics
        if (millis() - lastHeartbeat > 5000) {
            if (HID.ready()) {
                Serial.println("STATUS: HID Connected.");
            } else {
                Serial.println("STATUS: HID Waiting/Disconnected.");
            }
            lastHeartbeat = millis();
        }
        return;
    }

    // 2. Check Magic Header
    if (serial_buffer[0] != MAGIC_HEADER) {
        // Not a valid packet, drain buffer to sync
        while(Serial.available()) Serial.read();
        return;
    }

    // 3. Read Body
    size_t bodyLen = Serial.readBytes(serial_buffer, SERIAL_BUFFER_SIZE);
    if (bodyLen != SERIAL_BUFFER_SIZE) {
        // Incomplete packet
        return;
    }

    // 4. Visual Feedback (Short Blink)
    digitalWrite(LED_PIN, HIGH);

    // 5. Forward to HID
    updateTouchState(serial_buffer);
    
    // Turn off LED
    digitalWrite(LED_PIN, LOW);
}
