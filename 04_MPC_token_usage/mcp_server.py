from fastmcp import FastMCP
from google.cloud import monitoring_v3
from google.cloud import bigquery
from google.protobuf.timestamp_pb2 import Timestamp
import datetime
import logging

# Initialize FastMCP server
mcp = FastMCP("google-token-usage")

@mcp.tool()
def list_token_metrics(project_id: str) -> str:
    """
    Lists available metrics in Google Cloud Monitoring that contain 'token' in their name.
    Useful for finding the exact metric type for Gemini/Vertex AI usage.
    """
    try:
        client = monitoring_v3.MetricServiceClient()
        project_name = f"projects/{project_id}"
        
        filter_str = 'metric.type = has_substring("token")'
        results = client.list_metric_descriptors(name=project_name, filter=filter_str)
        
        metrics = []
        for result in results:
            metrics.append(result.type)
            
        if not metrics:
            return "No metrics found containing 'token'. You might need to check 'aiplatform.googleapis.com' metrics generally."
            
        return "Found metrics:\n" + "\n".join(metrics)
    except Exception as e:
        return f"Error listing metrics: {str(e)}"

@mcp.tool()
def get_monthly_metric_sum(project_id: str, metric_type: str) -> str:
    """
    Calculates the sum of a specific metric for the current month (from the 1st to now).
    Use this to get the total token count if you know the metric name (e.g., found via list_token_metrics).
    """
    try:
        client = monitoring_v3.MetricServiceClient()
        project_name = f"projects/{project_id}"

        now = datetime.datetime.now(datetime.timezone.utc)
        first_day = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        
        interval = monitoring_v3.TimeInterval()
        interval.end_time.FromDatetime(now)
        interval.start_time.FromDatetime(first_day)

        # Aggregation settings: Sum over the time period
        aggregation = monitoring_v3.Aggregation(
            alignment_period={"seconds": int((now - first_day).total_seconds())},
            per_series_aligner=monitoring_v3.Aggregation.Aligner.ALIGN_SUM,
            cross_series_reducer=monitoring_v3.Aggregation.Reducer.REDUCE_SUM
        )

        results = client.list_time_series(
            request={
                "name": project_name,
                "filter": f'metric.type = "{metric_type}"',
                "interval": interval,
                "view": monitoring_v3.ListTimeSeriesRequest.TimeSeriesView.FULL,
                "aggregation": aggregation
            }
        )

        total_val = 0
        for result in results:
            for point in result.points:
                # Assuming int64 value for counts
                total_val += point.value.int64_value

        return f"Total for {metric_type} this month: {total_val}"

    except Exception as e:
        return f"Error querying metric: {str(e)}"

@mcp.tool()
def query_billing_token_usage_from_bigquery(project_id: str, table_id: str) -> str:
    """
    Queries Google Cloud Billing Export in BigQuery to get token usage for the current month.
    
    Args:
        project_id: The Google Cloud Project ID to filter usage for.
        table_id: The BigQuery table ID where billing data is exported. 
                  Format: `project-id.dataset_id.gcp_billing_export_v1_XXXXXX_XXXXXX_XXXXXX`
                  
    Note: Requires that you have set up Cloud Billing Export to BigQuery.
    """
    try:
        client = bigquery.Client()
        
        now = datetime.datetime.now(datetime.timezone.utc)
        first_day_str = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).strftime('%Y-%m-%d %H:%M:%S')
        
        # Safe query construction using parameters is hard with table names, 
        # but bigquery python client handles params well for values.
        # We trust the user provided table_id is correct or it will error.
        
        query = f"""
            SELECT
                sku.description,
                SUM(usage.amount) as total_usage,
                usage.unit
            FROM
                `{table_id}`
            WHERE
                usage_start_time >= TIMESTAMP(@start_date)
                AND project.id = @project_id
                AND (LOWER(sku.description) LIKE "%token%" OR LOWER(usage.unit) LIKE "%token%")
            GROUP BY
                sku.description, usage.unit
            ORDER BY
                total_usage DESC
        """
        
        job_config = bigquery.QueryJobConfig(
            query_parameters=[
                bigquery.ScalarQueryParameter("start_date", "STRING", first_day_str),
                bigquery.ScalarQueryParameter("project_id", "STRING", project_id),
            ]
        )
        
        query_job = client.query(query, job_config=job_config)
        results = query_job.result()
        
        output = []
        for row in results:
            output.append(f"SKU: {row.description} | Usage: {row.total_usage} {row.unit}")
            
        if not output:
            return "No token usage found in billing data for this month."
            
        return "\n".join(output)

    except Exception as e:
        return f"Error querying BigQuery: {str(e)}\nHint: Ensure you have the 'BigQuery Data Viewer' and 'BigQuery Job User' roles, and the table ID is correct."

if __name__ == "__main__":
    mcp.run()
