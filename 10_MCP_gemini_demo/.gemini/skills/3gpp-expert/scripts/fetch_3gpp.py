import sys
import os
import requests
import zipfile
import io

def fetch_3gpp_spec(spec_id):
    """
    Simulates fetching a 3GPP spec. 
    In a real scenario, this would crawl https://www.3gpp.org/ftp/Specs/archive/
    For this demo, we use a specific known spec URL if possible, or a placeholder.
    """
    # Example: TS 23.501 (5G System Architecture)
    # Note: Real 3GPP URLs are deep and versioned. 
    # This is a simplified fetcher for the demo.
    print(f"Searching for 3GPP {spec_id}...")
    
    # Placeholder: In a real implementation, we'd use BeautifulSoup to find the latest version.
    # For the demo, we'll try to download a small publicly available sample or provide instructions.
    url = f"https://www.3gpp.org/ftp/Specs/archive/23_series/23.501/23501-g00.zip"
    
    try:
        response = requests.get(url, timeout=20)
        if response.status_code == 200:
            with zipfile.ZipFile(io.BytesIO(response.content)) as z:
                # Extract the .docx file
                z.extractall("3gpp_temp")
                files = os.listdir("3gpp_temp")
                return f"Success: Downloaded and extracted {files}"
        else:
            return f"Error: Could not find spec {spec_id} at {url}"
    except Exception as e:
        return f"Error: {str(e)}"

if __name__ == "__main__":
    if len(sys.argv) > 1:
        print(fetch_3gpp_spec(sys.argv[1]))
    else:
        print("Usage: python fetch_3gpp.py <spec_id>")
