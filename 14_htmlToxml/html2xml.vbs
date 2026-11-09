' ==============================================================================
' html2xml.vbs
' Drag-and-drop HTML to XML Converter using native Windows COM components
' ==============================================================================
Option Explicit

' ADODB.Stream Constants
Const adTypeBinary = 1
Const adTypeText = 2
Const adReadAll = -1
Const adSaveCreateOverWrite = 2

' ==============================================================================
' DetectEncoding(filePath)
' Detects the text encoding of an HTML file.
' Detection order:
'   1. Byte Order Mark (BOM): UTF-8 (EF BB BF), UTF-16LE (FF FE), UTF-16BE (FE FF)
'   2. HTML <meta> charset tag in the first 2048 bytes
'   3. Default fallback: "shift_jis"
' ==============================================================================
Function DetectEncoding(filePath)
    Dim binStream, fileSize
    Set binStream = CreateObject("ADODB.Stream")
    binStream.Type = adTypeBinary
    binStream.Open
    binStream.LoadFromFile filePath
    
    fileSize = binStream.Size
    
    ' Check Byte Order Mark (BOM)
    If fileSize >= 2 Then
        Dim byteCount, rawBytes
        byteCount = 4
        If fileSize < byteCount Then byteCount = fileSize
        
        rawBytes = binStream.Read(byteCount)
        
        Dim b0, b1, b2
        b0 = 0 : b1 = 0 : b2 = 0
        If LenB(rawBytes) >= 1 Then b0 = AscB(MidB(rawBytes, 1, 1))
        If LenB(rawBytes) >= 2 Then b1 = AscB(MidB(rawBytes, 2, 1))
        If LenB(rawBytes) >= 3 Then b2 = AscB(MidB(rawBytes, 3, 1))
        
        ' UTF-8 BOM: &HEF &HBB &HBF (239, 187, 191)
        If LenB(rawBytes) >= 3 Then
            If b0 = &HEF And b1 = &HBB And b2 = &HBF Then
                binStream.Close
                Set binStream = Nothing
                DetectEncoding = "utf-8"
                Exit Function
            End If
        End If
        
        ' UTF-16LE BOM: &HFF &HFE
        If b0 = &HFF And b1 = &HFE Then
            binStream.Close
            Set binStream = Nothing
            DetectEncoding = "unicode"
            Exit Function
        End If
        
        ' UTF-16BE BOM: &HFE &HFF
        If b0 = &HFE And b1 = &HFF Then
            binStream.Close
            Set binStream = Nothing
            DetectEncoding = "unicodeFFFE"
            Exit Function
        End If
    End If
    
    binStream.Close
    Set binStream = Nothing
    
    ' If file is empty, return default fallback
    If fileSize = 0 Then
        DetectEncoding = "shift_jis"
        Exit Function
    End If
    
    ' Read first 2048 bytes as single-byte text to inspect meta charset
    Dim readLen, textStream, headerText
    readLen = 2048
    If fileSize < readLen Then readLen = fileSize
    headerText = ""
    
    Set textStream = CreateObject("ADODB.Stream")
    textStream.Type = adTypeText
    textStream.Charset = "iso-8859-1"
    textStream.Open
    textStream.LoadFromFile filePath
    headerText = textStream.ReadText(readLen)
    textStream.Close
    Set textStream = Nothing
    
    ' Search for meta charset using RegExp
    Dim reg, matches
    Set reg = CreateObject("VBScript.RegExp")
    reg.IgnoreCase = True
    reg.Global = False
    
    ' Pattern 1: <meta ... charset="...">
    reg.Pattern = "<meta[^>]+charset=[""']?([a-zA-Z0-9_\-]+)"
    Set matches = reg.Execute(headerText)
    If matches.Count > 0 Then
        DetectEncoding = LCase(matches(0).SubMatches(0))
        Set reg = Nothing
        Exit Function
    End If
    
    ' Pattern 2: <meta ... content="...; charset=...">
    reg.Pattern = "<meta[^>]+content=[""'][^""']*charset=([a-zA-Z0-9_\-]+)"
    Set matches = reg.Execute(headerText)
    If matches.Count > 0 Then
        DetectEncoding = LCase(matches(0).SubMatches(0))
        Set reg = Nothing
        Exit Function
    End If
    
    Set reg = Nothing
    
    ' Default fallback: Shift_JIS
    DetectEncoding = "shift_jis"
End Function

' ==============================================================================
' ReadTextFile(filePath, charset)
' Reads and returns the entire text content of a file using ADODB.Stream.
' ==============================================================================
Function ReadTextFile(filePath, charset)
    Dim stream
    Set stream = CreateObject("ADODB.Stream")
    stream.Type = adTypeText
    stream.Charset = charset
    stream.Open
    stream.LoadFromFile filePath
    
    If stream.EOS Then
        ReadTextFile = ""
    Else
        ReadTextFile = stream.ReadText(adReadAll)
    End If
    
    stream.Close
    Set stream = Nothing
End Function

' ==============================================================================
' SaveTextFile(outputPath, textContent, charset)
' Writes text content to a file with the specified charset using ADODB.Stream.
' Overwrites existing files (adSaveCreateOverWrite = 2).
' ==============================================================================
Sub SaveTextFile(outputPath, textContent, charset)
    Dim stream
    Set stream = CreateObject("ADODB.Stream")
    stream.Type = adTypeText
    stream.Charset = charset
    stream.Open
    stream.WriteText textContent
    stream.SaveToFile outputPath, adSaveCreateOverWrite
    stream.Close
    Set stream = Nothing
End Sub
