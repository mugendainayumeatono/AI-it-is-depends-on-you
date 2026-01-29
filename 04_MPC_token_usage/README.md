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
    ```bash
    gcloud auth application-default login
    ```
    或者设置 `GOOGLE_APPLICATION_CREDENTIALS` 环境变量指向你的 JSON 密钥文件。

## 使用方法

### 运行 MCP 服务器

```bash
python mcp_server.py
```

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
