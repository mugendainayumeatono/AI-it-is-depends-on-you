from fastapi import FastAPI, Response
from fastapi.responses import HTMLResponse
from datetime import datetime
import uvicorn

app = FastAPI()

@app.get("/", response_class=HTMLResponse)
async def read_root():
    html_content = """
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Real-time System Time</title>
        <style>
            body {
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                height: 100vh;
                margin: 0;
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background-color: #f0f2f5;
                color: #1c1e21;
            }
            .container {
                text-align: center;
                background: white;
                padding: 2rem 4rem;
                border-radius: 12px;
                box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            }
            h1 {
                font-size: 1.5rem;
                color: #65676b;
                margin-bottom: 1rem;
            }
            #time {
                font-size: 4rem;
                font-weight: bold;
                color: #1877f2;
                font-variant-numeric: tabular-nums;
            }
            .date {
                font-size: 1.2rem;
                color: #65676b;
                margin-top: 0.5rem;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>Current System Time</h1>
            <div id="time">Loading...</div>
            <div id="date" class="date"></div>
        </div>
        <script>
            async function updateTime() {
                try {
                    const response = await fetch('/api/time');
                    const data = await response.json();
                    document.getElementById('time').innerText = data.time;
                    document.getElementById('date').innerText = data.date;
                } catch (error) {
                    console.error('Error fetching time:', error);
                }
            }
            
            // Initial call
            updateTime();
            // Update every second
            setInterval(updateTime, 1000);
        </script>
    </body>
    </html>
    """
    return HTMLResponse(content=html_content)

@app.get("/api/time")
async def get_time():
    now = datetime.now()
    return {
        "time": now.strftime("%H:%M:%S"),
        "date": now.strftime("%Y-%m-%d %A")
    }

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
