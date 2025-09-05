#!/bin/bash

cd "$(dirname "$0")"

# Define the path to the virtual environment
VENV_PATH="./venv"
# Define the PID file path
PID_FILE="./bot.pid"
# Define the Flask app module and callable
FLASK_APP_MODULE="app:app"
# Define the default port for Gunicorn
PORT=3978

start_bot() {
    if [ -f "$PID_FILE" ]; then
        echo "Bot is already running with PID $(cat $PID_FILE)."
        exit 1
    fi

    echo "Starting bot..."
    # Load environment variables from .env file in the same directory as the script
    if [ -f "./.env" ]; then
        source ./.env
    else
        echo "Warning: .env file not found in the script directory. Ensure environment variables are set."
    fi

    # Activate virtual environment
    source "$VENV_PATH/bin/activate"

    # Start Gunicorn in the background
    gunicorn --bind 0.0.0.0:$PORT --workers 4 "$FLASK_APP_MODULE" &
    BOT_PID=$!
    echo "$BOT_PID" > "$PID_FILE"
    echo "Bot started with PID $BOT_PID on port $PORT."
    deactivate # Deactivate venv after starting gunicorn
}

stop_bot() {
    if [ ! -f "$PID_FILE" ]; then
        echo "Bot is not running."
        exit 1
    fi

    BOT_PID=$(cat "$PID_FILE")
    echo "Stopping bot with PID $BOT_PID..."
    kill "$BOT_PID"
    rm "$PID_FILE"
    echo "Bot stopped."
}

status_bot() {
    if [ -f "$PID_FILE" ]; then
        BOT_PID=$(cat "$PID_FILE")
        if ps -p "$BOT_PID" > /dev/null; then
            echo "Bot is running with PID $BOT_PID."
        else
            echo "Bot PID file exists, but process is not running. Removing stale PID file."
            rm "$PID_FILE"
            echo "Bot is not running."
        fi
    else
        echo "Bot is not running."
    fi
}

restart_bot() {
    stop_bot
    start_bot
}

case "$1" in
    start)
        start_bot
        ;;
    stop)
        stop_bot
        ;;
    restart)
        restart_bot
        ;;
    status)
        status_bot
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status}"
        exit 1
        ;;
esac

exit 0