# AI Agent Instructions: Google Cloud Token Usage MCP

Use the following instructions to understand how to utilize the "Google Token Usage" MCP server capabilities effectively.

## Service Overview
This MCP server provides tools to query Google Cloud Platform (GCP) for token usage data, specifically focusing on Large Language Models (LLMs) like Gemini and Vertex AI. It bridges the gap between raw cloud metrics/billing data and user questions about consumption.

## Tool Definitions & Usage Strategy

### 1. `query_billing_token_usage_from_bigquery`
*   **Description**: Queries the official Google Cloud Billing export table in BigQuery.
*   **Best For**: Accurate, billing-aligned token counts. This is the **preferred method** if the user has Billing Export enabled.
*   **Parameters**:
    *   `project_id` (string): The GCP Project ID.
    *   `table_id` (string): The full BigQuery table ID containing billing data (e.g., `my-project.billing_dataset.gcp_billing_export_v1_XXXXXX`).
*   **Strategy**:
    *   Ask the user if they have "Cloud Billing Export to BigQuery" enabled.
    *   If yes, ask for the `table_id` and use this tool.
    *   It returns a breakdown of usage by SKU (e.g., "Input Tokens", "Output Tokens").

### 2. `list_token_metrics`
*   **Description**: Searches the Google Cloud Monitoring API for any metrics containing the substring "token".
*   **Best For**: Discovery. Use this when you don't know the exact metric name for a specific model or service.
*   **Parameters**:
    *   `project_id` (string): The GCP Project ID.
*   **Strategy**:
    *   Use this first if the user relies on Cloud Monitoring (not Billing Export).
    *   Look for metrics like `aiplatform.googleapis.com/publisher/model/endpoint/prediction/token_count` or similar custom metrics.

### 3. `get_monthly_metric_sum`
*   **Description**: Aggregates the sum of a specific metric from the 1st of the current month to the current moment.
*   **Best For**: Getting a "Month-to-Date" total for a specific technical metric found via `list_token_metrics`.
*   **Parameters**:
    *   `project_id` (string): The GCP Project ID.
    *   `metric_type` (string): The exact metric URI (e.g., `aiplatform.googleapis.com/...`).
*   **Strategy**:
    *   Call this *after* obtaining a valid `metric_type` from `list_token_metrics`.

## Standard Operating Procedure (SOP) for AI

1.  **Context Gathering**:
    *   Always ensure you have the `project_id`. If not provided, ask the user: "Which Google Cloud Project ID should I check?"
    *   Determine the data source preference: "Do you want to check via Cloud Monitoring metrics (approximate) or BigQuery Billing Export (precise)?"

2.  **Scenario A: Billing/Cost Focus (Preferred)**
    *   If the user mentions "cost", "bill", or "precise usage", attempt to use `query_billing_token_usage_from_bigquery`.
    *   *Requirement*: You need the BigQuery `table_id`.

3.  **Scenario B: Technical/Monitoring Focus**
    *   If the user just wants a quick technical check or doesn't have BigQuery export.
    *   Step 1: Call `list_token_metrics(project_id="...")`.
    *   Step 2: Analyze the list. Look for `token_count` related to `aiplatform` or `prediction`.
    *   Step 3: Call `get_monthly_metric_sum` for the most relevant metric types found.
    *   Step 4: Report the total to the user, noting that this is "monitoring data" and might differ slightly from the final bill.

## Example Interaction

**User**: "How many Gemini tokens did I use this month in project 'my-ai-app'?"

**AI Thought Process**:
1.  I have the project ID: `my-ai-app`.
2.  I don't have a BigQuery table ID, so I will default to Monitoring.
3.  First, I need to see what token metrics exist.

**Tool Call**: `list_token_metrics(project_id="my-ai-app")`

**Tool Output**:
```text
Found metrics:
aiplatform.googleapis.com/publisher/model/endpoint/prediction/token_count
```

**AI Thought Process**:
1.  I found the metric. Now I will sum it up for the current month.

**Tool Call**: `get_monthly_metric_sum(project_id="my-ai-app", metric_type="aiplatform.googleapis.com/publisher/model/endpoint/prediction/token_count")`

**Tool Output**: `Total for ... this month: 154300`

**AI Response**: "According to Cloud Monitoring, project 'my-ai-app' has consumed approximately **154,300 tokens** this month via the Vertex AI Prediction service."
