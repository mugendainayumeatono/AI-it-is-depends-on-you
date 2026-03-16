import asyncio
import os
import sys
from mcp.client.session import ClientSession
from mcp.client.stdio import stdio_client, StdioServerParameters

async def run():
    # 从命令行参数获取项目 ID
    if len(sys.argv) < 2:
        print("\n❌ 错误: 缺失必要参数 'PROJECT_ID'。")
        print(f"用法: python {sys.argv[0]} <PROJECT_ID>")
        sys.exit(1)
        
    project_id = sys.argv[1]
    print(f"使用项目 ID: {project_id}\n")

    # 配置启动 MCP 服务器的参数
    # 假设该测试脚本在 test/ 目录下运行，所以 server 脚本在上一级目录
    server_script_path = os.path.join(os.path.dirname(__file__), "..", "mcp_server.py")
    
    print("\n--- CLIENT-SIDE ENV INFO ---")
    print(f"GOOGLE_APPLICATION_CREDENTIALS: {os.environ.get('GOOGLE_APPLICATION_CREDENTIALS')}")
    print(f"MCP_DEBUG: {os.environ.get('MCP_DEBUG')}")
    print("--------------------------\n")

    server_params = StdioServerParameters(
        command="python",
        args=["-u", server_script_path], 
        env=os.environ.copy() # 显式传递环境变量给子进程
    )

    print("正在启动并连接到 MCP 服务器...")
    
    try:
        # stdio_client 负责通过标准输入/输出启动并连接子进程
        async with stdio_client(server_params) as (read, write):
            # ClientSession 负责处理 MCP 协议的通信逻辑
            async with ClientSession(read, write) as session:
                # 1. 初始化连接
                await session.initialize()
                print("✅ 已成功连接并初始化 MCP 会话。\n")

                # 2. 列出服务器提供的所有可用工具
                tools_response = await session.list_tools()
                print("🛠️ 服务器提供的工具列表:")
                for tool in tools_response.tools:
                    print(f"  - {tool.name}: {tool.description}")
                print()

                # 3. 调用特定工具进行测试: list_token_metrics
                print(f"🚀 正在调用工具 'list_token_metrics' (Project: {project_id})...")
                try:
                    result = await session.call_tool(
                        "list_token_metrics",
                        arguments={"project_id": project_id}
                    )
                    
                    print("\n📄 工具执行结果:")
                    # MCP tool 调用的结果通常是一个列表，其中包含文本或其他类型的内容块
                    for content in result.content:
                        if content.type == "text":
                            print(content.text)
                            
                except Exception as e:
                    print(f"\n❌ 工具调用失败: {e}")
                    
    except Exception as e:
        print(f"❌ 连接 MCP 服务器失败: {e}")

if __name__ == "__main__":
    asyncio.run(run())
