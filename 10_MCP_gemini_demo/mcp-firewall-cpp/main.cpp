#include <iostream>
#include <string>
#include <vector>
#include <cstdio>
#include <memory>
#include <stdexcept>
#include "json.hpp"

using json = nlohmann::json;
using namespace std;

// 执行系统命令并获取输出
string exec(const char* cmd) {
    char buffer[128];
    string result = "";
    unique_ptr<FILE, decltype(&pclose)> pipe(popen(cmd, "r"), pclose);
    if (!pipe) {
        throw runtime_error("popen() failed!");
    }
    while (fgets(buffer, sizeof(buffer), pipe.get()) != nullptr) {
        result += buffer;
    }
    return result;
}

void send_response(const json& resp) {
    cout << resp.dump() << endl;
}

int main() {
    string line;
    while (getline(cin, line)) {
        if (line.empty()) continue;
        json id = nullptr;
        try {
            json req;
            try {
                req = json::parse(line);
            } catch (const json::parse_error& e) {
                json resp = {
                    {"jsonrpc", "2.0"},
                    {"id", nullptr},
                    {"error", {
                        {"code", -32700},
                        {"message", "Parse error"}
                    }}
                };
                send_response(resp);
                continue;
            }
            
            if (req.contains("id")) {
                id = req["id"];
            }
            
            if (!req.contains("method") || !req["method"].is_string()) {
                json resp = {
                    {"jsonrpc", "2.0"},
                    {"id", id},
                    {"error", {
                        {"code", -32600},
                        {"message", "Invalid Request"}
                    }}
                };
                send_response(resp);
                continue;
            }
            
            string method = req["method"];

            if (method == "initialize") {
                json resp = {
                    {"jsonrpc", "2.0"},
                    {"id", id},
                    {"result", {
                        {"protocolVersion", "2024-11-05"},
                        {"capabilities", {
                            {"tools", json::object()}
                        }},
                        {"serverInfo", {
                            {"name", "firewall-cpp-mcp"},
                            {"version", "1.0.0"}
                        }}
                    }}
                };
                send_response(resp);
            }
            else if (method == "tools/list") {
                json resp = {
                    {"jsonrpc", "2.0"},
                    {"id", id},
                    {"result", {
                        {"tools", {
                            {
                                {"name", "get_firewall_status"},
                                {"description", "Check the system firewall (UFW) status configuration"},
                                {"inputSchema", {
                                    {"type", "object"},
                                    {"properties", json::object()}
                                }}
                            }
                        }}
                    }}
                };
                send_response(resp);
            }
            else if (method == "tools/call") {
                if (!req.contains("params") || !req["params"].is_object() || !req.at("params").contains("name") || !req["params"]["name"].is_string()) {
                    json resp = {
                        {"jsonrpc", "2.0"},
                        {"id", id},
                        {"error", {
                            {"code", -32602},
                            {"message", "Invalid params"}
                        }}
                    };
                    send_response(resp);
                    continue;
                }
                
                string tool_name = req["params"]["name"];
                json result_content;
                
                if (tool_name == "get_firewall_status") {
                    try {
                        // 注意：在实际环境中可能需要 sudo 权限，建议配置免密 sudo ufw
                        string output = exec("sudo ufw status 2>&1");
                        result_content = {
                            {"content", {
                                {{"type", "text"}, {"text", output}}
                            }}
                        };
                    } catch (const exception& e) {
                        result_content = {
                            {"isError", true},
                            {"content", {
                                {{"type", "text"}, {"text", string("Error executing command: ") + e.what()}}
                            }}
                        };
                    }
                } else {
                    result_content = {
                        {"isError", true},
                        {"content", {
                            {{"type", "text"}, {"text", "Unknown tool"}}
                        }}
                    };
                }

                json resp = {
                    {"jsonrpc", "2.0"},
                    {"id", id},
                    {"result", result_content}
                };
                send_response(resp);
            }
            else {
                json resp = {
                    {"jsonrpc", "2.0"},
                    {"id", id},
                    {"error", {
                        {"code", -32601},
                        {"message", "Method not found"}
                    }}
                };
                send_response(resp);
            }
        } catch (const exception& e) {
            // 错误处理，输出到 stderr 以免干扰 stdout 的 JSON 流
            cerr << "Error: " << e.what() << endl;
            json resp = {
                {"jsonrpc", "2.0"},
                {"id", id},
                {"error", {
                    {"code", -32603},
                    {"message", e.what()}
                }}
            };
            send_response(resp);
        }
    }
    return 0;
}
