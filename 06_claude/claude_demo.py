import os
from dotenv import load_dotenv
from anthropic import Anthropic

# Load environment variables from .env file
load_dotenv()

def main():
    # Initialize the Anthropic client
    # It will automatically look for the ANTHROPIC_API_KEY environment variable
    client = Anthropic(
        api_key=os.getenv("ANTHROPIC_API_KEY")
    )

    # Simple message request
    print("Sending message to Claude...")
    try:
        message = client.messages.create(
            model="claude-4-6-sonnet-20260217",
            max_tokens=1024,
            messages=[
                {"role": "user", "content": "Hello, Claude! Please introduce yourself briefly."}
            ]
        )
        
        # Print the response
        print("\nClaude's Response:")
        print("-" * 20)
        print(message.content[0].text)
        print("-" * 20)
        
    except Exception as e:
        print(f"\nAn error occurred: {e}")
        print("Make sure you have set the ANTHROPIC_API_KEY in your .env file.")

if __name__ == "__main__":
    main()
