#ifndef apple_intelligence_bridge_h
#define apple_intelligence_bridge_h

// C-compatible function declarations for Swift bridge

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    char* response;
    int success; // 0 for failure, 1 for success
    char* error_message; // Only valid when success = 0
} AppleLLMResponse;

typedef struct {
    char* bundle_id;
    char* localized_name;
    int success; // 0 for failure, 1 for success
    char* error_message; // Only valid when success = 0
} FrontmostAppResponse;

typedef struct {
    char* json_payload;
    int success; // 0 for failure, 1 for success
    char* error_message; // Only valid when success = 0
} ScreenContextCaptureResponse;

// Check if Apple Intelligence is available on the device
int is_apple_intelligence_available(void);

// Process text using Apple's on-device LLM with separate system prompt and user content
AppleLLMResponse* process_text_with_system_prompt_apple(const char* system_prompt, const char* user_content, int max_tokens);

// Free memory allocated by the Apple LLM response
void free_apple_llm_response(AppleLLMResponse* response);

// Look up the frontmost macOS application for app-aware tone selection.
FrontmostAppResponse* get_frontmost_app_context_apple(void);

// Free memory allocated by the frontmost app lookup response.
void free_frontmost_app_response(FrontmostAppResponse* response);

// Check whether Screen Recording permission is currently granted.
int check_screen_recording_permission_apple(void);

// Capture OCR snippets for the active display and return a JSON payload.
ScreenContextCaptureResponse* capture_screen_context_apple(const char* quality_mode, int max_words, int timeout_ms);

// Free memory allocated by the screen context capture response.
void free_screen_context_capture_response(ScreenContextCaptureResponse* response);

#ifdef __cplusplus
}
#endif

#endif /* apple_intelligence_bridge_h */
