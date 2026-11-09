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
            DetectEncoding = "utf-16"
            Exit Function
        End If
        
        ' UTF-16BE BOM: &HFE &HFF
        If b0 = &HFE And b1 = &HFF Then
            binStream.Close
            Set binStream = Nothing
            DetectEncoding = "utf-16be"
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

' ==============================================================================
' SanitizeXmlName(nameStr)
' Sanitizes a tag or attribute name for XML compliance:
' - Retains alphanumeric characters, hyphens, underscores, and colons
' - Ensures it starts with a valid character (letter or underscore)
' ==============================================================================
Function SanitizeXmlName(nameStr)
    Dim i, ch, clean, firstCh
    clean = ""
    For i = 1 To Len(nameStr)
        ch = Mid(nameStr, i, 1)
        If (ch >= "a" And ch <= "z") Or (ch >= "A" And ch <= "Z") Or (ch >= "0" And ch <= "9") Or ch = "_" Or ch = "-" Or ch = ":" Then
            clean = clean & ch
        End If
    Next
    If Len(clean) = 0 Then
        SanitizeXmlName = ""
        Exit Function
    End If
    firstCh = Left(clean, 1)
    If Not ((firstCh >= "a" And firstCh <= "z") Or (firstCh >= "A" And firstCh <= "Z") Or firstCh = "_") Then
        clean = "_" & clean
    End If
    SanitizeXmlName = clean
End Function

' ==============================================================================
' ConvertHtmlToXml(htmlContent, charset)
' Parses HTML string using MSHTML (htmlfile COM object),
' constructs a well-formed XML DOM using MSXML2.DOMDocument,
' and returns the XML string.
' ==============================================================================
Function ConvertHtmlToXml(htmlContent, charset)
    Dim htmlDoc, xmlDoc, pi, xmlRoot
    Dim rootAttr, rName, rVal, xmlResult, endPi, piText

    Set htmlDoc = CreateObject("htmlfile")
    htmlDoc.open
    htmlDoc.write htmlContent
    htmlDoc.close

    On Error Resume Next
    Set xmlDoc = CreateObject("MSXML2.DOMDocument.6.0")
    If xmlDoc Is Nothing Then
        Set xmlDoc = CreateObject("MSXML2.DOMDocument")
    End If
    On Error GoTo 0

    If xmlDoc Is Nothing Then
        Err.Raise vbObjectError + 1, "ConvertHtmlToXml", "Failed to create MSXML2.DOMDocument component."
        ConvertHtmlToXml = ""
        Exit Function
    End If

    xmlDoc.async = False
    xmlDoc.resolveExternals = False

    Set pi = xmlDoc.createProcessingInstruction("xml", "version=""1.0"" encoding=""" & charset & """")
    xmlDoc.appendChild pi

    Set xmlRoot = xmlDoc.createElement("html")
    xmlDoc.appendChild xmlRoot

    If Not htmlDoc.documentElement Is Nothing Then
        If Not htmlDoc.documentElement.attributes Is Nothing Then
            For Each rootAttr In htmlDoc.documentElement.attributes
                rName = ""
                rVal = ""
                On Error Resume Next
                If rootAttr.specified Then
                    rName = LCase(rootAttr.name)
                    rName = SanitizeXmlName(rName)
                    If Len(rName) > 0 Then
                        If Not IsNull(rootAttr.value) And Not IsObject(rootAttr.value) Then
                            rVal = CStr(rootAttr.value)
                        End If
                        Err.Clear
                        xmlRoot.setAttribute rName, rVal
                        If Err.Number <> 0 Then
                            Err.Clear
                            If InStr(rName, ":") > 0 Then
                                rName = Replace(rName, ":", "_")
                                xmlRoot.setAttribute rName, rVal
                                If Err.Number <> 0 Then Err.Clear
                            End If
                        End If
                    End If
                End If
                On Error GoTo 0
            Next
        End If

        AppendXmlChildNodes htmlDoc.documentElement, xmlRoot, xmlDoc
    End If

    xmlResult = xmlDoc.xml
    endPi = InStr(xmlResult, "?>")
    If endPi > 0 Then
        piText = Left(xmlResult, endPi)
        If InStr(piText, "encoding") = 0 Then
            xmlResult = "<?xml version=""1.0"" encoding=""" & charset & """?>" & Mid(xmlResult, endPi + 2)
        End If
    Else
        xmlResult = "<?xml version=""1.0"" encoding=""" & charset & """?>" & vbCrLf & xmlResult
    End If

    ConvertHtmlToXml = xmlResult

    Set htmlDoc = Nothing
    Set xmlDoc = Nothing
End Function

' ==============================================================================
' AppendXmlChildNodes(htmlNode, xmlParentNode, xmlDoc)
' Recursively traverses MSHTML child nodes and appends corresponding
' XML elements, text nodes, and comment nodes to xmlParentNode.
' ==============================================================================
Sub AppendXmlChildNodes(htmlNode, xmlParentNode, xmlDoc)
    If htmlNode Is Nothing Then Exit Sub
    If htmlNode.childNodes Is Nothing Then Exit Sub

    Dim child, nodeTypeVal
    Dim rawName, tagName, xmlElem
    Dim attr, aName, aVal
    Dim textVal, xmlText
    Dim commentVal, xmlComment

    For Each child In htmlNode.childNodes
        On Error Resume Next
        nodeTypeVal = child.nodeType
        If Err.Number <> 0 Then
            nodeTypeVal = 0
            Err.Clear
        End If
        On Error GoTo 0

        Select Case nodeTypeVal
            Case 1 ' Element node
                rawName = LCase(child.nodeName)
                tagName = SanitizeXmlName(rawName)

                If Len(tagName) > 0 Then
                    Set xmlElem = Nothing
                    On Error Resume Next
                    Set xmlElem = xmlDoc.createElement(tagName)
                    If Err.Number <> 0 Or xmlElem Is Nothing Then
                        Err.Clear
                        If InStr(tagName, ":") > 0 Then
                            tagName = Replace(tagName, ":", "_")
                            Set xmlElem = xmlDoc.createElement(tagName)
                            If Err.Number <> 0 Then Set xmlElem = Nothing
                        End If
                    End If
                    On Error GoTo 0

                    If Not xmlElem Is Nothing Then
                        If Not child.attributes Is Nothing Then
                            For Each attr In child.attributes
                                aName = ""
                                aVal = ""
                                On Error Resume Next
                                If attr.specified Then
                                    aName = LCase(attr.name)
                                    aName = SanitizeXmlName(aName)
                                    If Len(aName) > 0 Then
                                        If aName = "style" And IsObject(child.style) Then
                                            aVal = child.style.cssText
                                        ElseIf Not IsNull(attr.value) And Not IsObject(attr.value) Then
                                            aVal = CStr(attr.value)
                                        End If
                                        Err.Clear
                                        xmlElem.setAttribute aName, aVal
                                        If Err.Number <> 0 Then
                                            Err.Clear
                                            If InStr(aName, ":") > 0 Then
                                                aName = Replace(aName, ":", "_")
                                                xmlElem.setAttribute aName, aVal
                                                If Err.Number <> 0 Then Err.Clear
                                            End If
                                        End If
                                    End If
                                End If
                                On Error GoTo 0
                            Next
                        End If

                        xmlParentNode.appendChild xmlElem
                        AppendXmlChildNodes child, xmlElem, xmlDoc
                    End If
                End If

            Case 3 ' Text node
                textVal = ""
                On Error Resume Next
                textVal = child.nodeValue
                If Err.Number = 0 And Len(textVal) > 0 Then
                    Set xmlText = xmlDoc.createTextNode(textVal)
                    If Err.Number = 0 And Not xmlText Is Nothing Then
                        xmlParentNode.appendChild xmlText
                    End If
                End If
                Err.Clear
                On Error GoTo 0

            Case 8 ' Comment node
                commentVal = ""
                On Error Resume Next
                commentVal = child.nodeValue
                If Err.Number = 0 Then
                    Do While InStr(commentVal, "--") > 0
                        commentVal = Replace(commentVal, "--", "- -")
                    Loop
                    If Right(commentVal, 1) = "-" Then
                        commentVal = commentVal & " "
                    End If
                    Set xmlComment = xmlDoc.createComment(commentVal)
                    If Err.Number = 0 And Not xmlComment Is Nothing Then
                        xmlParentNode.appendChild xmlComment
                    End If
                End If
                Err.Clear
                On Error GoTo 0
        End Select
    Next
End Sub

' ==============================================================================
' Main()
' Entry point for drag-and-drop batch processing.
' ==============================================================================
Sub Main()
    If WScript.Arguments.Count = 0 Then
        MsgBox "Please drag and drop HTML file(s) onto this script icon to convert." & vbCrLf & vbCrLf & _
               "Usage instructions:" & vbCrLf & _
               "1. Supports dragging single or multiple .html / .htm files;" & vbCrLf & _
               "2. Automatically detects source file encoding (defaults to Shift_JIS when unstated);" & vbCrLf & _
               "3. Converted .xml files will be saved in the same directory as the source files.", vbInformation, "HTML to XML Converter"
        WScript.Quit
    End If

    Dim fso, i, filePath, ext, parentFolder, baseName, xmlPath
    Dim encoding, htmlContent, xmlContent, errDesc
    Dim successCount, failCount, skipCount, reportDetails, summaryMsg
    Dim detailLines, truncatedDetails, k, totalDetails

    Set fso = CreateObject("Scripting.FileSystemObject")
    successCount = 0
    failCount = 0
    skipCount = 0
    reportDetails = ""

    For i = 0 To WScript.Arguments.Count - 1
        filePath = Trim(WScript.Arguments.Item(i))

        If Not fso.FileExists(filePath) Then
            skipCount = skipCount + 1
            If fso.FolderExists(filePath) Then
                reportDetails = reportDetails & vbCrLf & "[SKIPPED] Directory conversion is not supported: " & fso.GetFileName(filePath)
            Else
                reportDetails = reportDetails & vbCrLf & "[SKIPPED] File not found: " & filePath
            End If
        Else
            ext = LCase(fso.GetExtensionName(filePath))
            If ext <> "html" And ext <> "htm" Then
                skipCount = skipCount + 1
                reportDetails = reportDetails & vbCrLf & "[SKIPPED] Not an HTML file: " & fso.GetFileName(filePath)
            Else
                parentFolder = fso.GetParentFolderName(filePath)
                baseName = fso.GetBaseName(filePath)
                xmlPath = fso.BuildPath(parentFolder, baseName & ".xml")

                On Error Resume Next
                Err.Clear
                encoding = ""
                htmlContent = ""
                xmlContent = ""

                encoding = DetectEncoding(filePath)
                htmlContent = ReadTextFile(filePath, encoding)
                xmlContent = ConvertHtmlToXml(htmlContent, encoding)
                If Err.Number = 0 And Len(xmlContent) = 0 And Len(htmlContent) > 0 Then
                    Err.Raise vbObjectError + 2, "Main", "XML conversion result is empty."
                End If
                If Err.Number = 0 Then
                    SaveTextFile xmlPath, xmlContent, encoding
                End If

                If Err.Number = 0 Then
                    successCount = successCount + 1
                    reportDetails = reportDetails & vbCrLf & "[SUCCESS] " & fso.GetFileName(filePath) & " -> " & baseName & ".xml (" & encoding & ")"
                Else
                    failCount = failCount + 1
                    errDesc = Err.Description
                    If Len(errDesc) = 0 Then errDesc = "Unknown error (Error code &H" & Hex(Err.Number) & ")"
                    reportDetails = reportDetails & vbCrLf & "[FAILED] " & fso.GetFileName(filePath) & ": " & errDesc
                    Err.Clear
                End If
                On Error GoTo 0
            End If
        End If
    Next

    Set fso = Nothing

    summaryMsg = "HTML to XML conversion completed!" & vbCrLf & vbCrLf & _
                 "Succeeded: " & successCount & vbCrLf & _
                 "Failed:    " & failCount & vbCrLf & _
                 "Skipped:   " & skipCount

    If (failCount > 0 Or skipCount > 0 Or successCount <= 5) And Len(reportDetails) > 0 Then
        detailLines = Split(Mid(reportDetails, Len(vbCrLf) + 1), vbCrLf)
        totalDetails = UBound(detailLines) + 1
        If totalDetails > 15 Then
            truncatedDetails = ""
            For k = 0 To 14
                truncatedDetails = truncatedDetails & vbCrLf & detailLines(k)
            Next
            truncatedDetails = truncatedDetails & vbCrLf & "... (" & totalDetails & " items in total, remaining details omitted)"
            reportDetails = truncatedDetails
        End If
        summaryMsg = summaryMsg & vbCrLf & vbCrLf & "Details:" & reportDetails
    End If

    MsgBox summaryMsg, vbInformation, "Conversion Complete"
End Sub

' Execute main entry point
Call Main()
