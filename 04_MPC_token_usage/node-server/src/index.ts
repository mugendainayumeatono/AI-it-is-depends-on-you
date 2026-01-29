import express from 'express';
import cors from 'cors';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { MetricServiceClient } from '@google-cloud/monitoring';
import { BigQuery } from '@google-cloud/bigquery';
import { z } from 'zod';

const app = express();
app.use(cors());

// Initialize Google Cloud Clients
const monitoringClient = new MetricServiceClient();
const bigqueryClient = new BigQuery();

// Initialize MCP Server
const server = new Server(
  {
    name: "google-token-usage",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Helper to calculate start of month
function getStartOfMonth() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { now, start };
}

// Register Tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "list_token_metrics",
        description: "Lists available metrics in Google Cloud Monitoring that contain 'token' in their name.",
        inputSchema: {
          type: "object",
          properties: {
            project_id: { type: "string" },
          },
          required: ["project_id"],
        },
      },
      {
        name: "get_monthly_metric_sum",
        description: "Calculates the sum of a specific metric for the current month (from the 1st to now).",
        inputSchema: {
          type: "object",
          properties: {
            project_id: { type: "string" },
            metric_type: { type: "string" },
          },
          required: ["project_id", "metric_type"],
        },
      },
      {
        name: "query_billing_token_usage_from_bigquery",
        description: "Queries Google Cloud Billing Export in BigQuery to get token usage for the current month.",
        inputSchema: {
          type: "object",
          properties: {
            project_id: { type: "string" },
            table_id: { type: "string", description: "Format: project-id.dataset_id.gcp_billing_export_v1_XXXXXX" },
          },
          required: ["project_id", "table_id"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "list_token_metrics") {
      const { project_id } = args as { project_id: string };
      const projectPath = monitoringClient.projectPath(project_id);
      
      const filter = 'metric.type = has_substring("token")';
      const [descriptors] = await monitoringClient.listMetricDescriptors({
        name: projectPath,
        filter: filter,
      });

      const metrics = descriptors.map(d => d.type).filter((t): t is string => !!t);

      if (metrics.length === 0) {
        return {
          content: [{ type: "text", text: "No metrics found containing 'token'. You might need to check 'aiplatform.googleapis.com' metrics generally." }],
        };
      }

      return {
        content: [{ type: "text", text: "Found metrics:\n" + metrics.join("\n") }],
      };
    }

    if (name === "get_monthly_metric_sum") {
      const { project_id, metric_type } = args as { project_id: string, metric_type: string };
      const { now, start } = getStartOfMonth();
      const projectPath = monitoringClient.projectPath(project_id);

      const [timeSeries] = await monitoringClient.listTimeSeries({
        name: projectPath,
        filter: `metric.type = "${metric_type}"`, 
        interval: {
          startTime: { seconds: Math.floor(start.getTime() / 1000) },
          endTime: { seconds: Math.floor(now.getTime() / 1000) },
        },
        view: 'FULL',
        aggregation: {
            alignmentPeriod: { seconds: Math.floor((now.getTime() - start.getTime()) / 1000) },
            perSeriesAligner: 'ALIGN_SUM',
            crossSeriesReducer: 'REDUCE_SUM',
        }
      });

      let totalVal = 0;
      timeSeries.forEach(series => {
        series.points?.forEach(point => {
            if (point.value?.int64Value) {
                totalVal += Number(point.value.int64Value);
            }
        });
      });

      return {
        content: [{ type: "text", text: `Total for ${metric_type} this month: ${totalVal}` }],
      };
    }

    if (name === "query_billing_token_usage_from_bigquery") {
      const { project_id, table_id } = args as { project_id: string, table_id: string };
      const { start } = getStartOfMonth();
      // Format as YYYY-MM-DD HH:MM:SS
      const startStr = start.toISOString().replace('T', ' ').substring(0, 19);

      const query = `
        SELECT
            sku.description,
            SUM(usage.amount) as total_usage,
            usage.unit
        FROM
            `${table_id}`
        WHERE
            usage_start_time >= TIMESTAMP(@start_date)
            AND project.id = @project_id
            AND (LOWER(sku.description) LIKE "%token%" OR LOWER(usage.unit) LIKE "%token%")
        GROUP BY
            sku.description, usage.unit
        ORDER BY
            total_usage DESC
      `;

      const options = {
        query: query,
        params: {
          start_date: startStr,
          project_id: project_id
        }
      };

      const [rows] = await bigqueryClient.query(options);
      
      if (!rows || rows.length === 0) {
          return {
              content: [{ type: "text", text: "No token usage found in billing data for this month." }]
          };
      }

      const output = rows.map((row: any) => `SKU: ${row.description} | Usage: ${row.total_usage} ${row.unit}`).join("\n");
      
      return {
        content: [{ type: "text", text: output }],
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error: any) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// SSE Endpoint
// Store active sessions in memory (Valid for single-instance deployments like Cloud Run, but NOT for Vercel Serverless)
const sessions = new Map<string, SSEServerTransport>();

app.get('/sse', async (req, res) => {
  const transport = new SSEServerTransport('/messages', res);
  await server.connect(transport);
  
  // Store session
  if (transport.sessionId) {
    sessions.set(transport.sessionId, transport);
  }

  // Cleanup on close
  req.on('close', () => {
    if (transport.sessionId) {
        sessions.delete(transport.sessionId);
    }
  });
});

app.post('/messages', async (req, res) => {
  const sessionId = req.query.sessionId as string;
  
  if (!sessionId) {
      res.status(400).send("Missing sessionId query parameter");
      return;
  }

  const transport = sessions.get(sessionId);
  if (!transport) {
    res.status(404).send("Session not found or server restarted. Please reconnect.");
    return;
  }
  
  // Pass the request to the transport
  await transport.handlePostMessage(req, res);
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
