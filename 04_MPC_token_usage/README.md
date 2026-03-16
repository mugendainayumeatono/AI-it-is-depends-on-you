# Google Token Usage MCP Server

这是一个 MCP (Model Context Protocol) 服务，用于通过 Google Cloud Monitoring API 查询当前月份的 Google Cloud 项目（如 Vertex AI/Gemini）的 Token 使用情况。

## 前置要求

1.  **Python 3.10+**
2.  **Google Cloud Project**: 需要一个启用了 Monitoring API 的 Google Cloud 项目。
3.  **Authentication**: 需要配置 Google Cloud 凭据 (Application Default Credentials)。

## 安装

1.  安装依赖:
    ```bash
    pip install -r requirements.txt
    ```

2.  认证:
    获取 Google Cloud 凭据 (Application Default Credentials, ADC) 有两种主要方式：

    **方式一：使用 gcloud CLI（推荐本地开发）**
    确保已安装 [Google Cloud CLI](https://cloud.google.com/sdk/docs/install)，然后运行：
    ```bash
    gcloud auth application-default login
    ```
    这将打开浏览器进行登录，并在默认路径（如 `~/.config/gcloud/application_default_credentials.json`）生成凭据文件。对于依赖环境默认凭据的程序，这样就足够了。

    **方式二：使用服务账号密钥 (Service Account Key)**
    如果你在服务器、容器环境运行，或者不想使用个人账号：
    1. 前往 Google Cloud Console 的 [服务账号页面](https://console.cloud.google.com/iam-admin/serviceaccounts)。
    2. 创建或选择一个服务账号，确保其具有相关权限（如 `Monitoring Viewer`、`BigQuery Data Viewer` 和 `BigQuery Job User` 等）。
    3. 进入服务账号详情，点击“密钥”选项卡 -> “添加密钥” -> “创建新密钥” -> 选择 “JSON” 格式。
    4. 下载生成的 JSON 文件到本地。
    5. 设置 `GOOGLE_APPLICATION_CREDENTIALS` 环境变量指向该 JSON 文件的绝对路径：
       ```bash
       export GOOGLE_APPLICATION_CREDENTIALS="/path/to/your/service-account-file.json"
       ```

## 使用方法

### 方式一：Docker 运行 (推荐)

项目提供了一个便捷的脚本来构建并运行 Docker 容器。脚本会自动将本地的凭据挂载到容器内。此外，构建时会自动使用当前时间戳（例如 `v20240316-123000`）和 `latest` 标签标记镜像。

```bash
# 赋予脚本执行权限（仅需一次）
chmod +x run_docker.sh run_test_docker.sh

# 运行容器
./run_docker.sh

# 如果需要强制重新构建镜像，可以加上 -b 或 --build 参数
./run_docker.sh -b
```

**环境变量与凭据配置 (.env):**

建议在项目根目录下创建一个 `.env` 文件。脚本启动时会自动加载 `.env` 中的环境变量。
例如，要配置具体的 JSON 密钥文件路径，可以在 `.env` 中添加：
```ini
GOOGLE_APPLICATION_CREDENTIALS=/path/to/your/service-account-file.json
```
这样你无需修改任何脚本，就可以在不同凭据之间无缝切换。

**调试模式:**

如果你在启动或运行中遇到凭据相关问题，可以添加 `-d` 或 `--debug` 参数启动调试模式，这会输出相关的环境变量和挂载文件内容（通过向容器传递 `MCP_DEBUG=true`）：
```bash
./run_docker.sh --debug
```

### 方式二：直接运行 MCP 服务器

```bash
python mcp_server.py
```

---

## 本地测试 MCP 服务器

项目中包含一个基于 Python 的测试客户端 `test/test_mcp_server.py`，用于模拟 AI 客户端通过 `stdio` 与 MCP 服务端通信的完整流程。

你可以通过提供的 Docker 测试脚本一键运行测试：

```bash
# 运行测试，需要传入你的 Google Cloud 项目 ID
./run_test_docker.sh your-project-id

# 强制构建镜像并开启调试模式运行测试
./run_test_docker.sh -b -d your-project-id
```
测试脚本会自动：
1. 启动容器并进入 `stdio` 通信模式。
2. 连接到 MCP 服务器。
3. 枚举服务器提供的工具列表。
4. 调用 `list_token_metrics` 工具进行真实请求验证。

---

### 可用工具 (Tools)

该服务暴露了以下工具:

1.  `list_token_metrics(project_id: str)`
    *   **描述**: 列出项目中所有名称包含 "token" 的 Cloud Monitoring 指标。
    *   **用途**: 用于查找具体的 Gemini 或 Vertex AI Token 计数指标名称（例如 `aiplatform.googleapis.com/.../token_count`）。

2.  `get_monthly_metric_sum(project_id: str, metric_type: str)`
    *   **描述**: 查询指定指标在**本月**（从1号到现在）的累加总和。
    *   **参数**:
        *   `project_id`: Google Cloud 项目 ID。
        *   `metric_type`: 指标类型名称。

3.  `query_billing_token_usage_from_bigquery(project_id: str, table_id: str)`
    *   **描述**: 通过 BigQuery 查询 Google Cloud Billing 导出数据，获取本月 Token 使用量。
    *   **参数**:
        *   `project_id`: 要查询的项目 ID。
        *   `table_id`: BigQuery 中的账单导出表 ID。格式通常为 `project-id.dataset_id.gcp_billing_export_v1_XXXXXX_XXXXXX_XXXXXX`。
    *   **前置条件**: 您必须已在 Google Cloud Billing 中配置了导出到 BigQuery。

## 常见指标参考

对于 Vertex AI Gemini，您可能需要查找如下指标 (如果可用):
*   `aiplatform.googleapis.com/publisher/model/endpoint/prediction/token_count`
*   或者在 Cloud Console 中确认具体的 Metric Name。

注意: 如果找不到直接的 Token 指标，可能需要使用 Google Cloud Billing API 来获取精确的计费 Token 数，但这通常需要更高的权限。本工具专注于 Monitoring API。
