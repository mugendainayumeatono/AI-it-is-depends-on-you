# HTML to XML VBScript Converter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a drag-and-drop VBScript script (`html2xml.vbs`) for Windows that converts HTML files into well-formed XML in the same directory, dynamically preserving the source HTML encoding with a Japanese default fallback (`shift_jis`).

**Architecture:** A standalone VBScript script utilizing Windows COM automation: `ADODB.Stream` for binary BOM inspection and encoded text I/O, `htmlfile` (MSHTML) for error-tolerant HTML parsing, and `MSXML2.DOMDocument` for generating well-formed XML.

**Tech Stack:** VBScript, Windows Script Host (WSH), MSHTML (`htmlfile`), MSXML2 (`MSXML2.DOMDocument.6.0`), ADO (`ADODB.Stream`), Python 3 (for test fixtures and validation on Linux).

**Spec:** `docs/superpowers/specs/2026-11-08-html-to-xml-vbs-design.md`

## Global Constraints

- Native Windows VBScript environment without requiring 3rd-party installations (zero external dependencies).
- Drag-and-drop support via `WScript.Arguments`.
- Output XML saved in the same directory as source HTML (`<source_basename>.xml`).
- Encoding detection order: BOM -> Meta charset regex -> Japanese default fallback (`shift_jis`).
- Dynamic encoding preservation: XML declaration `<?xml version="1.0" encoding="..."?>` and output file encoding must match source.
- Strict XML compliance: unclosed HTML tags and non-conforming elements must be converted into valid closed XML nodes.

## Review Focus

- Japanese HTML file with no BOM and no meta tag defaults to Shift_JIS: must decode Japanese characters without corruption and output XML with `encoding="shift_jis"`.
- Void/unclosed HTML tags (`<br>`, `<img>`, `<meta>`, `<hr>`, `<input>`) must be properly closed in output XML (e.g. `<br/>` or `<br></br>`).
- HTML entities (e.g. `&nbsp;`, `&amp;`, `&lt;`) and special characters in text/attributes must be properly escaped in XML.
- Argument handling when user double-clicks the script with 0 arguments: show friendly guidance prompt without throwing errors.
- Handling multiple dropped files: process each file independently; an error in one file should not stop the remaining files.

---

### Task 1: Test Fixtures and Static Validation Suite

**Files:**
- Create: `tests/fixtures/sample_utf8_bom.html`
- Create: `tests/fixtures/sample_utf8_meta.html`
- Create: `tests/fixtures/sample_sjis_meta.html`
- Create: `tests/fixtures/sample_sjis_nobom_nometa.html`
- Create: `tests/fixtures/sample_unclosed_tags.html`
- Create: `tests/test_vbs_structure.py`

**Interfaces:**
- Produces: Test fixture HTML files in UTF-8 and Shift_JIS encodings, and Python test script `tests/test_vbs_structure.py` to validate `html2xml.vbs` syntax, encoding regex, fallback logic, and DOM conversion structures.

- [ ] **Step 1: Write Python script generating test fixtures and static verification tests**

```python
# tests/test_vbs_structure.py
import os
import re
import pytest

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures")

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
```

- [ ] **Step 2: Run test to verify it fails (since `html2xml.vbs` does not exist yet)**

Run: `pytest tests/test_vbs_structure.py -v`
Expected: FAIL with "FileNotFoundError: html2xml.vbs not found"

- [ ] **Step 3: Commit test fixtures and test harness**

```bash
git add tests/
git commit -m "test: add HTML test fixtures and static verification suite"
```

---

### Task 2: Implement Encoding Detection and Stream I/O in VBScript

**Files:**
- Create: `html2xml.vbs`

**Interfaces:**
- Produces:
  - `Function DetectEncoding(filePath)`: Returns encoding string (`"utf-8"`, `"unicode"`, `"unicodeFFFE"`, or parsed meta charset, falling back to `"shift_jis"`).
  - `Function ReadTextFile(filePath, charset)`: Returns decoded string using `ADODB.Stream`.
  - `Sub SaveTextFile(outputPath, textContent, charset)`: Writes text to file using `ADODB.Stream` with specified charset.

- [ ] **Step 1: Write VBScript functions for BOM detection, Meta charset extraction, and ADODB.Stream I/O**

Implement in `html2xml.vbs`:
- Binary read first 4 bytes via `ADODB.Stream` (Type=1).
- Detect UTF-8 (`EF BB BF`), UTF-16LE (`FF FE`), UTF-16BE (`FE FF`).
- If no BOM, read first 2048 bytes as text and apply `RegExp` for `<meta[^>]+charset=["']?([a-zA-Z0-9_\-]+)` and `<meta[^>]+content=["'][^"']*charset=([a-zA-Z0-9_\-]+)`.
- Fall back to `"shift_jis"` when no match is found.
- Implement `ReadTextFile` and `SaveTextFile` using `ADODB.Stream`.

- [ ] **Step 2: Run static test suite to verify encoding detection logic and functions exist**

Run: `pytest tests/test_vbs_structure.py -k "test_encoding_and_io" -v`
Expected: PASS

- [ ] **Step 3: Commit encoding detection and I/O implementation**

```bash
git add html2xml.vbs
git commit -m "feat: implement encoding detection and stream I/O in html2xml.vbs"
```

---

### Task 3: Implement HTML to XML DOM Conversion Engine

**Files:**
- Modify: `html2xml.vbs`

**Interfaces:**
- Consumes: `ReadTextFile`, `SaveTextFile`
- Produces:
  - `Function ConvertHtmlToXml(htmlContent, charset)`: Parses HTML string via `htmlfile`, builds `MSXML2.DOMDocument.6.0`, and returns XML string.
  - `Sub AppendXmlChildNodes(htmlNode, xmlParentNode, xmlDoc)`: Recursive helper for mapping HTML elements, attributes, text nodes, and comments into XML DOM.

- [ ] **Step 1: Implement DOM conversion and node sanitization**

Implement in `html2xml.vbs`:
- Create `htmlDoc = CreateObject("htmlfile")`.
- Write HTML string to `htmlDoc`: `htmlDoc.open : htmlDoc.write htmlContent : htmlDoc.close`.
- Create `xmlDoc = CreateObject("MSXML2.DOMDocument.6.0")` (with fallback to `MSXML2.DOMDocument`).
- Create XML processing instruction: `xmlDoc.createProcessingInstruction("xml", "version=""1.0"" encoding=""" & charset & """")`.
- Append root node (`<html>` element) and recursively traverse MSHTML child nodes:
  - Element (nodeType = 1): Sanitize tag name (lowercase, strip invalid characters), copy specified attributes (`attr.specified`), recursively process child nodes.
  - Text (nodeType = 3): Create text node `xmlDoc.createTextNode(htmlNode.nodeValue)`.
  - Comment (nodeType = 8): Create comment node `xmlDoc.createComment(htmlNode.nodeValue)`.
- Format and return `xmlDoc.xml`.

- [ ] **Step 2: Run verification test on conversion logic**

Run: `pytest tests/test_vbs_structure.py -k "test_dom_conversion" -v`
Expected: PASS

- [ ] **Step 3: Commit DOM conversion implementation**

```bash
git add html2xml.vbs
git commit -m "feat: implement MSHTML to MSXML conversion in html2xml.vbs"
```

---

### Task 4: Implement Drag-and-Drop Workflow and Batch Processing

**Files:**
- Modify: `html2xml.vbs`

**Interfaces:**
- Consumes: `DetectEncoding`, `ReadTextFile`, `ConvertHtmlToXml`, `SaveTextFile`
- Produces: Main execution block parsing `WScript.Arguments`, handling multiple files, generating destination paths, and displaying result dialog.

- [ ] **Step 1: Implement argument processing and main controller**

Implement in `html2xml.vbs`:
- Check `WScript.Arguments.Count`:
  - If 0: Display usage prompt via `MsgBox` ("请将需要转换的 HTML 文件拖拽到此脚本图标上执行。") and exit.
- Loop through each argument `filePath`:
  - Check `fso.FileExists(filePath)` and extension (`.html`, `.htm`).
  - Calculate target XML path: `folder & "\" & baseName & ".xml"`.
  - Execute conversion with error trapping (`On Error Resume Next`).
  - Record success/failure status and counts.
- Display summary message box when batch processing finishes.

- [ ] **Step 2: Run full static validation suite**

Run: `pytest tests/test_vbs_structure.py -v`
Expected: All tests PASS

- [ ] **Step 3: Commit complete script**

```bash
git add html2xml.vbs
git commit -m "feat: implement drag-and-drop workflow and batch processing in html2xml.vbs"
```

---

### Task 5: Add Documentation and Usage Guide

**Files:**
- Create: `README.md`

**Interfaces:**
- Produces: Clear user documentation explaining how to use `html2xml.vbs`, encoding detection behavior (including default Japanese Shift_JIS), and drag-and-drop operations on Windows.

- [ ] **Step 1: Write `README.md` with detailed instructions**

Include:
- Usage instructions (drag and drop HTML files onto `html2xml.vbs`).
- Encoding detection hierarchy and Shift_JIS default behavior.
- Examples and troubleshooting for Windows users.

- [ ] **Step 2: Verify all files are committed and git status is clean**

Run: `git status`
Expected: Working tree clean

- [ ] **Step 3: Commit documentation**

```bash
git add README.md
git commit -m "docs: add user guide for html2xml.vbs"
```
