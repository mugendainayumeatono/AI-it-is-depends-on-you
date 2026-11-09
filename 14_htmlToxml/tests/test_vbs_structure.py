import os
import re
import pytest

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures")
VBS_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "html2xml.vbs"))


@pytest.fixture(scope="session", autouse=True)
def setup_fixtures():
    os.makedirs(FIXTURES_DIR, exist_ok=True)
    # UTF-8 with BOM
    with open(os.path.join(FIXTURES_DIR, "sample_utf8_bom.html"), "wb") as f:
        f.write(b'\xef\xbb\xbf<html><head><title>UTF-8 BOM</title></head><body><p>Hello World</p></body></html>')
    # UTF-8 with meta
    with open(os.path.join(FIXTURES_DIR, "sample_utf8_meta.html"), "w", encoding="utf-8") as f:
        f.write('<html><head><meta charset="utf-8"><title>UTF-8 Meta</title></head><body><p>测试</p></body></html>')
    # Shift_JIS with meta
    with open(os.path.join(FIXTURES_DIR, "sample_sjis_meta.html"), "w", encoding="shift_jis") as f:
        f.write('<html><head><meta http-equiv="Content-Type" content="text/html; charset=shift_jis"><title>SJIS Meta</title></head><body><p>こんにちは</p></body></html>')
    # Shift_JIS without BOM and without meta (default fallback test)
    with open(os.path.join(FIXTURES_DIR, "sample_sjis_nobom_nometa.html"), "w", encoding="shift_jis") as f:
        f.write('<html><head><title>SJIS No Meta</title></head><body><p>日本語テキスト</p></body></html>')
    # Unclosed tags
    with open(os.path.join(FIXTURES_DIR, "sample_unclosed_tags.html"), "w", encoding="utf-8") as f:
        f.write('<html><head><title>Void Tags</title></head><body>Line 1<br>Line 2<hr><img src="pic.png"><input type="text" value="test"></body></html>')


def get_vbs_content():
    if not os.path.exists(VBS_PATH):
        raise FileNotFoundError("html2xml.vbs not found")
    with open(VBS_PATH, "r", encoding="utf-8", errors="replace") as f:
        return f.read()


@pytest.fixture
def vbs_content():
    return get_vbs_content()


def test_fixtures_integrity():
    """Verify that all fixture files exist and adhere to their respective encodings."""
    # 1. UTF-8 BOM
    utf8_bom_path = os.path.join(FIXTURES_DIR, "sample_utf8_bom.html")
    assert os.path.isfile(utf8_bom_path)
    with open(utf8_bom_path, "rb") as f:
        raw_bytes = f.read()
    assert raw_bytes.startswith(b"\xef\xbb\xbf")
    decoded_utf8_bom = raw_bytes[3:].decode("utf-8")
    assert "<title>UTF-8 BOM</title>" in decoded_utf8_bom
    assert "Hello World" in decoded_utf8_bom

    # 2. UTF-8 Meta
    utf8_meta_path = os.path.join(FIXTURES_DIR, "sample_utf8_meta.html")
    assert os.path.isfile(utf8_meta_path)
    with open(utf8_meta_path, "rb") as f:
        raw_meta_bytes = f.read()
    assert not raw_meta_bytes.startswith(b"\xef\xbb\xbf")
    decoded_utf8 = raw_meta_bytes.decode("utf-8")
    assert 'charset="utf-8"' in decoded_utf8.lower()
    assert "测试" in decoded_utf8

    # 3. Shift_JIS Meta
    sjis_meta_path = os.path.join(FIXTURES_DIR, "sample_sjis_meta.html")
    assert os.path.isfile(sjis_meta_path)
    with open(sjis_meta_path, "rb") as f:
        raw_sjis_bytes = f.read()
    decoded_sjis = raw_sjis_bytes.decode("shift_jis")
    assert "charset=shift_jis" in decoded_sjis.lower()
    assert "こんにちは" in decoded_sjis

    # 4. Shift_JIS No BOM No Meta
    sjis_nobom_path = os.path.join(FIXTURES_DIR, "sample_sjis_nobom_nometa.html")
    assert os.path.isfile(sjis_nobom_path)
    with open(sjis_nobom_path, "rb") as f:
        raw_nobom_bytes = f.read()
    assert not raw_nobom_bytes.startswith(b"\xef\xbb\xbf")
    assert b"charset" not in raw_nobom_bytes.lower()
    decoded_nobom = raw_nobom_bytes.decode("shift_jis")
    assert "日本語テキスト" in decoded_nobom

    # 5. Void / Unclosed tags
    unclosed_path = os.path.join(FIXTURES_DIR, "sample_unclosed_tags.html")
    assert os.path.isfile(unclosed_path)
    with open(unclosed_path, "r", encoding="utf-8") as f:
        unclosed_html = f.read()
    assert "<br>" in unclosed_html
    assert "<hr>" in unclosed_html
    assert '<img src="pic.png">' in unclosed_html
    assert '<input type="text"' in unclosed_html


def test_vbs_file_exists():
    """Verify html2xml.vbs exists in the repository root and is not empty."""
    content = get_vbs_content()
    assert os.path.isfile(VBS_PATH)
    assert len(content.strip()) > 0


def test_encoding_and_io(vbs_content):
    """Validate encoding detection, fallback, and Stream I/O routines."""
    # Check function definitions
    assert re.search(r"Function\s+DetectEncoding\s*\(", vbs_content, re.IGNORECASE), (
        "DetectEncoding function is missing in html2xml.vbs"
    )
    assert re.search(r"Function\s+ReadTextFile\s*\(", vbs_content, re.IGNORECASE), (
        "ReadTextFile function is missing in html2xml.vbs"
    )
    assert re.search(r"(Sub|Function)\s+SaveTextFile\s*\(", vbs_content, re.IGNORECASE), (
        "SaveTextFile subroutine/function is missing in html2xml.vbs"
    )

    # Check ADODB.Stream usage
    assert re.search(r"ADODB\.Stream", vbs_content, re.IGNORECASE), (
        "ADODB.Stream must be used for binary BOM inspection and text I/O"
    )

    # Check Shift_JIS fallback
    assert re.search(r"shift_jis", vbs_content, re.IGNORECASE), (
        "DetectEncoding must fall back to 'shift_jis' when no BOM or meta charset is found"
    )

    # Check BOM detection logic for UTF-8 and UTF-16
    assert (
        re.search(r"(&HEF|&HBB|&HBF|239|187|191)", vbs_content, re.IGNORECASE)
        or re.search(r"utf-8", vbs_content, re.IGNORECASE)
    ), "BOM detection logic must handle UTF-8 BOM"
    assert re.search(r'DetectEncoding\s*=\s*["\']utf-16["\']', vbs_content, re.IGNORECASE), (
        "DetectEncoding must return standardized 'utf-16' for UTF-16LE BOM"
    )
    assert re.search(r'DetectEncoding\s*=\s*["\']utf-16be["\']', vbs_content, re.IGNORECASE), (
        "DetectEncoding must return standardized 'utf-16be' for UTF-16BE BOM"
    )

    # Check regex pattern for meta charset detection
    assert re.search(r"VBScript\.RegExp", vbs_content, re.IGNORECASE), (
        "VBScript.RegExp must be used for meta tag charset extraction"
    )
    assert re.search(r"charset", vbs_content, re.IGNORECASE), (
        "Regex must search for charset in meta tags"
    )

    # Extract regex patterns from VBScript and test against fixture samples
    raw_patterns = re.findall(r'\.Pattern\s*=\s*"((?:""|[^"])+)"', vbs_content, re.IGNORECASE)
    patterns = [p.replace('""', '"') for p in raw_patterns]
    assert len(patterns) > 0, "Could not find any regex .Pattern assignments in VBScript"

    # Test that at least one regex matches sample_utf8_meta.html charset
    utf8_meta_html = '<html><head><meta charset="utf-8"><title>UTF-8 Meta</title></head></html>'
    utf8_matched = False
    for pat in patterns:
        m = re.search(pat, utf8_meta_html, re.IGNORECASE)
        if m and m.group(1).lower() == "utf-8":
            utf8_matched = True
            break
    assert utf8_matched, f"None of the VBScript RegExp patterns {patterns} matched meta charset 'utf-8'"

    # Test that at least one regex matches sample_sjis_meta.html charset
    sjis_meta_html = '<html><head><meta http-equiv="Content-Type" content="text/html; charset=shift_jis"></head></html>'
    sjis_matched = False
    for pat in patterns:
        m = re.search(pat, sjis_meta_html, re.IGNORECASE)
        if m and m.group(1).lower() == "shift_jis":
            sjis_matched = True
            break
    assert sjis_matched, f"None of the VBScript RegExp patterns {patterns} matched http-equiv charset 'shift_jis'"


def test_dom_conversion(vbs_content):
    """Validate HTML-to-XML DOM conversion engine structures."""
    # Check function definitions
    assert re.search(r"Function\s+ConvertHtmlToXml\s*\(", vbs_content, re.IGNORECASE), (
        "ConvertHtmlToXml function is missing in html2xml.vbs"
    )
    assert re.search(r"(Sub|Function)\s+AppendXmlChildNodes\s*\(", vbs_content, re.IGNORECASE), (
        "AppendXmlChildNodes subroutine/function is missing in html2xml.vbs"
    )

    # Check MSHTML htmlfile creation
    assert re.search(r'CreateObject\s*\(\s*["\']htmlfile["\']\s*\)', vbs_content, re.IGNORECASE), (
        "MSHTML 'htmlfile' COM object creation is required for HTML parsing"
    )

    # Check MSXML DOMDocument creation
    assert re.search(r'CreateObject\s*\(\s*["\']MSXML2\.DOMDocument', vbs_content, re.IGNORECASE), (
        "MSXML2.DOMDocument COM object creation is required for XML construction"
    )

    # Check XML Processing Instruction with dynamic encoding
    assert re.search(r'createProcessingInstruction\s*\(\s*["\']xml["\']', vbs_content, re.IGNORECASE), (
        "createProcessingInstruction('xml', ...) is required to emit XML declaration"
    )

    # Check recursive DOM node processing (nodeType checks or node conversion)
    assert (
        re.search(r"nodeType", vbs_content, re.IGNORECASE)
        or re.search(r"createElement", vbs_content, re.IGNORECASE)
    ), "DOM conversion must traverse nodes and create corresponding XML elements"

    # Check that serialized XML declaration retains encoding parameter
    assert (
        re.search(r"xmlResult.*encoding", vbs_content, re.IGNORECASE)
        or re.search(r"InStr\(.*encoding", vbs_content, re.IGNORECASE)
    ), "ConvertHtmlToXml must verify and ensure 'encoding' is preserved in the final serialized XML declaration"

    # Check COM instantiation error guard and defensive null attribute check
    assert re.search(r"xmlDoc\s+Is\s+Nothing.*?Err\.Raise", vbs_content, re.IGNORECASE | re.DOTALL), (
        "ConvertHtmlToXml must explicitly raise an error when xmlDoc fails to instantiate"
    )
    assert re.search(r"IsNull\(.*attr.*value\)", vbs_content, re.IGNORECASE), (
        "ConvertHtmlToXml must defensively guard against Null attribute values"
    )


def test_main_workflow(vbs_content):
    """Validate drag-and-drop batch controller and argument handling."""
    # Check WScript.Arguments handling
    assert re.search(r"WScript\.Arguments", vbs_content, re.IGNORECASE), (
        "Script must handle WScript.Arguments for drag-and-drop functionality"
    )
    assert re.search(r"WScript\.Arguments\.Count", vbs_content, re.IGNORECASE), (
        "Script must inspect WScript.Arguments.Count"
    )

    # Check prompt when no arguments provided
    assert re.search(r"MsgBox", vbs_content, re.IGNORECASE) or re.search(
        r"WScript\.Echo", vbs_content, re.IGNORECASE
    ), "Script must display a guidance prompt when launched with 0 arguments"

    # Check file extension filtering (.html / .htm or html / htm)
    assert re.search(r"\.?html", vbs_content, re.IGNORECASE) and re.search(
        r"\.?htm", vbs_content, re.IGNORECASE
    ), "Script must validate .html and .htm file extensions"

    # Check target XML path construction
    assert re.search(r"\.xml", vbs_content, re.IGNORECASE), (
        "Script must output to a file with .xml extension in the same directory"
    )

    # Check empty XML safeguard
    assert re.search(r"Len\(xmlContent\)\s*=\s*0.*?Err\.Raise", vbs_content, re.IGNORECASE | re.DOTALL), (
        "Main must raise an error when XML output is empty despite non-empty HTML input"
    )

    # Check dialog truncation protection for large batches
    assert re.search(r"15", vbs_content) and (
        re.search(r"omitted", vbs_content, re.IGNORECASE) or re.search(r"其余明细已省略", vbs_content)
    ), "Main must truncate report details when exceeding 15 lines"


def test_vbs_ascii_only():
    """Verify html2xml.vbs contains strictly ASCII characters (no double-byte / multibyte characters)."""
    with open(VBS_PATH, "rb") as f:
        content = f.read()
    non_ascii = [(i, b) for i, b in enumerate(content) if b >= 128]
    assert len(non_ascii) == 0, f"Found {len(non_ascii)} non-ASCII / double-byte bytes in {VBS_PATH}"

