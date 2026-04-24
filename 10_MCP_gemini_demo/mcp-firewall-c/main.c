#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "cJSON.h"

// 执行系统命令并获取输出
char* exec_command(const char* cmd) {
    char buffer[128];
    char* result = NULL;
    size_t total_size = 0;
    FILE* pipe = popen(cmd, "r");
    if (!pipe) return strdup("popen() failed!");

    while (fgets(buffer, sizeof(buffer), pipe) != NULL) {
        size_t len = strlen(buffer);
        char* temp = realloc(result, total_size + len + 1);
        if (!temp) {
            free(result);
            pclose(pipe);
            return strdup("Memory allocation failed!");
        }
        result = temp;
        strcpy(result + total_size, buffer);
        total_size += len;
    }
    pclose(pipe);
    return result ? result : strdup("No output");
}

void send_response(cJSON* resp) {
    char* rendered = cJSON_PrintUnformatted(resp);
    if (rendered) {
        printf("%s\n", rendered);
        fflush(stdout);
        free(rendered);
    }
}

int main() {
    char line[4096];
    while (fgets(line, sizeof(line), stdin)) {
        cJSON* req = cJSON_Parse(line);
        if (!req) {
            cJSON* resp = cJSON_CreateObject();
            cJSON_AddStringToObject(resp, "jsonrpc", "2.0");
            cJSON* error = cJSON_CreateObject();
            cJSON_AddNumberToObject(error, "code", -32700);
            cJSON_AddStringToObject(error, "message", "Parse error");
            cJSON_AddItemToObject(resp, "error", error);
            send_response(resp);
            cJSON_Delete(resp);
            continue;
        }

        const cJSON* method = cJSON_GetObjectItemCaseSensitive(req, "method");
        const cJSON* id = cJSON_GetObjectItemCaseSensitive(req, "id");

        if (cJSON_IsString(method)) {
            if (strcmp(method->valuestring, "initialize") == 0) {
                cJSON* resp = cJSON_CreateObject();
                cJSON_AddStringToObject(resp, "jsonrpc", "2.0");
                if (id) {
                    cJSON_AddItemToObject(resp, "id", cJSON_Duplicate(id, 1));
                }
                
                cJSON* result = cJSON_CreateObject();
                cJSON_AddStringToObject(result, "protocolVersion", "2024-11-05");
                
                cJSON* capabilities = cJSON_CreateObject();
                cJSON_AddItemToObject(capabilities, "tools", cJSON_CreateObject());
                cJSON_AddItemToObject(result, "capabilities", capabilities);
                
                cJSON* serverInfo = cJSON_CreateObject();
                cJSON_AddStringToObject(serverInfo, "name", "firewall-c-mcp");
                cJSON_AddStringToObject(serverInfo, "version", "1.0.0");
                cJSON_AddItemToObject(result, "serverInfo", serverInfo);
                
                cJSON_AddItemToObject(resp, "result", result);
                send_response(resp);
                cJSON_Delete(resp);
            }
            else if (strcmp(method->valuestring, "tools/list") == 0) {
                cJSON* resp = cJSON_CreateObject();
                cJSON_AddStringToObject(resp, "jsonrpc", "2.0");
                if (id) {
                    cJSON_AddItemToObject(resp, "id", cJSON_Duplicate(id, 1));
                }
                
                cJSON* result = cJSON_CreateObject();
                cJSON* tools = cJSON_CreateArray();
                cJSON* tool = cJSON_CreateObject();
                cJSON_AddStringToObject(tool, "name", "get_firewall_status");
                cJSON_AddStringToObject(tool, "description", "Check the system firewall (UFW) status configuration");
                
                cJSON* inputSchema = cJSON_CreateObject();
                cJSON_AddStringToObject(inputSchema, "type", "object");
                cJSON_AddItemToObject(inputSchema, "properties", cJSON_CreateObject());
                cJSON_AddItemToObject(tool, "inputSchema", inputSchema);
                
                cJSON_AddItemToArray(tools, tool);
                cJSON_AddItemToObject(result, "tools", tools);
                cJSON_AddItemToObject(resp, "result", result);
                send_response(resp);
                cJSON_Delete(resp);
            }
            else if (strcmp(method->valuestring, "tools/call") == 0) {
                const cJSON* params = cJSON_GetObjectItemCaseSensitive(req, "params");
                const cJSON* tool_name = cJSON_GetObjectItemCaseSensitive(params, "name");
                
                if (!params || !cJSON_IsObject(params) || !tool_name || !cJSON_IsString(tool_name)) {
                    cJSON* resp = cJSON_CreateObject();
                    cJSON_AddStringToObject(resp, "jsonrpc", "2.0");
                    if (id) cJSON_AddItemToObject(resp, "id", cJSON_Duplicate(id, 1));
                    cJSON* error = cJSON_CreateObject();
                    cJSON_AddNumberToObject(error, "code", -32602);
                    cJSON_AddStringToObject(error, "message", "Invalid params");
                    cJSON_AddItemToObject(resp, "error", error);
                    send_response(resp);
                    cJSON_Delete(resp);
                    cJSON_Delete(req);
                    continue;
                }

                cJSON* resp = cJSON_CreateObject();
                cJSON_AddStringToObject(resp, "jsonrpc", "2.0");
                if (id) {
                    cJSON_AddItemToObject(resp, "id", cJSON_Duplicate(id, 1));
                }
                
                cJSON* result = cJSON_CreateObject();
                if (strcmp(tool_name->valuestring, "get_firewall_status") == 0) {
                    char* output = exec_command("sudo ufw status 2>&1");
                    cJSON* content_array = cJSON_CreateArray();
                    cJSON* content_obj = cJSON_CreateObject();
                    cJSON_AddStringToObject(content_obj, "type", "text");
                    cJSON_AddStringToObject(content_obj, "text", output ? output : "Internal Error: Command execution failed or Out of Memory");
                    cJSON_AddItemToArray(content_array, content_obj);
                    cJSON_AddItemToObject(result, "content", content_array);
                    if (output) free(output);
                } else {
                    cJSON_AddBoolToObject(result, "isError", 1);
                    cJSON* content_array = cJSON_CreateArray();
                    cJSON* content_obj = cJSON_CreateObject();
                    cJSON_AddStringToObject(content_obj, "type", "text");
                    cJSON_AddStringToObject(content_obj, "text", "Unknown tool");
                    cJSON_AddItemToArray(content_array, content_obj);
                    cJSON_AddItemToObject(result, "content", content_array);
                }
                cJSON_AddItemToObject(resp, "result", result);
                send_response(resp);
                cJSON_Delete(resp);
            } else {
                cJSON* resp = cJSON_CreateObject();
                cJSON_AddStringToObject(resp, "jsonrpc", "2.0");
                if (id) {
                    cJSON_AddItemToObject(resp, "id", cJSON_Duplicate(id, 1));
                }
                cJSON* error = cJSON_CreateObject();
                cJSON_AddNumberToObject(error, "code", -32601);
                cJSON_AddStringToObject(error, "message", "Method not found");
                cJSON_AddItemToObject(resp, "error", error);
                send_response(resp);
                cJSON_Delete(resp);
            }
        } else {
            cJSON* resp = cJSON_CreateObject();
            cJSON_AddStringToObject(resp, "jsonrpc", "2.0");
            if (id) {
                cJSON_AddItemToObject(resp, "id", cJSON_Duplicate(id, 1));
            }
            cJSON* error = cJSON_CreateObject();
            cJSON_AddNumberToObject(error, "code", -32600);
            cJSON_AddStringToObject(error, "message", "Invalid Request");
            cJSON_AddItemToObject(resp, "error", error);
            send_response(resp);
            cJSON_Delete(resp);
        }
        cJSON_Delete(req);
    }
    return 0;
}
