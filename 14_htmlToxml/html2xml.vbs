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
' IsVoidTag(tagName)
' Returns True if the specified tag is an HTML5 void element that does not have
' a closing tag.
' ==============================================================================
Function IsVoidTag(tagName)
    Select Case LCase(tagName)
        Case "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"
            IsVoidTag = True
        Case Else
            IsVoidTag = False
    End Select
End Function

' ==============================================================================
' ShouldAutoClose(currentTopTag, newTag)
' Determines if an open HTML element should be implicitly closed upon
' encountering a new sibling or parent-level tag.
' ==============================================================================
Function ShouldAutoClose(currentTopTag, newTag)
    Dim cur, nxt
    cur = LCase(currentTopTag)
    nxt = LCase(newTag)
    If cur = nxt Then
        Select Case cur
            Case "p", "li", "tr", "td", "th", "dt", "dd", "option"
                ShouldAutoClose = True
                Exit Function
        End Select
    End If
    If (cur = "td" Or cur = "th") And nxt = "tr" Then
        ShouldAutoClose = True
        Exit Function
    End If
    ShouldAutoClose = False
End Function

' ==============================================================================
' SanitizeComment(rawComment)
' Sanitizes an XML comment by replacing double hyphens and trailing hyphens.
' ==============================================================================
Function SanitizeComment(rawComment)
    Dim c
    c = rawComment
    Do While InStr(c, "--") > 0
        c = Replace(c, "--", "- -")
    Loop
    If Right(c, 1) = "-" Then
        c = c & " "
    End If
    SanitizeComment = c
End Function

' ==============================================================================
' SanitizeXmlText(rawStr)
' Removes ASCII control characters disallowed by the XML 1.0 specification:
' #x00-#x08, #x0B-#x0C, #x0E-#x1F, #x7F.
' Retains valid XML whitespace: Tab (#x09), LF (#x0A), CR (#x0D).
' ==============================================================================
Function SanitizeXmlText(rawStr)
    If Len(rawStr) = 0 Then
        SanitizeXmlText = ""
        Exit Function
    End If

    Dim reCtrl, clean
    Set reCtrl = CreateObject("VBScript.RegExp")
    reCtrl.Global = True
    reCtrl.IgnoreCase = True
    reCtrl.Pattern = "[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]"
    clean = reCtrl.Replace(rawStr, "")
    Set reCtrl = Nothing

    SanitizeXmlText = clean
End Function

' ==============================================================================
' SafeAppendTextNode(xmlDoc, parentNode, textStr)
' Safely creates and appends an XML text node, sanitizing control characters
' and defensively handling any MSXML invalid character rejections.
' ==============================================================================
Sub SafeAppendTextNode(xmlDoc, parentNode, textStr)
    If parentNode Is Nothing Then Exit Sub
    Dim clean, xmlText
    clean = SanitizeXmlText(textStr)
    If Len(clean) = 0 Then Exit Sub

    On Error Resume Next
    Err.Clear
    Set xmlText = xmlDoc.createTextNode(clean)
    If Err.Number = 0 And Not xmlText Is Nothing Then
        parentNode.appendChild xmlText
    Else
        ' Fallback: filter strictly to W3C XML 1.0 valid character code ranges
        Err.Clear
        Dim i, ch, code, sb
        sb = ""
        For i = 1 To Len(clean)
            ch = Mid(clean, i, 1)
            code = AscW(ch)
            If code < 0 Then code = code + 65536
            If code = 9 Or code = 10 Or code = 13 Or (code >= 32 And code <= 55295) Or (code >= 57344 And code <= 65533) Then
                sb = sb & ch
            End If
        Next
        If Len(sb) > 0 Then
            Set xmlText = xmlDoc.createTextNode(sb)
            If Err.Number = 0 And Not xmlText Is Nothing Then
                parentNode.appendChild xmlText
            End If
        End If
    End If
    On Error GoTo 0
End Sub

' ==============================================================================
' SafeAppendComment(xmlDoc, parentNode, commentStr)
' Safely creates and appends an XML comment node.
' ==============================================================================
Sub SafeAppendComment(xmlDoc, parentNode, commentStr)
    If parentNode Is Nothing Then Exit Sub
    Dim clean, xmlComment
    clean = SanitizeXmlText(SanitizeComment(commentStr))

    On Error Resume Next
    Err.Clear
    Set xmlComment = xmlDoc.createComment(clean)
    If Err.Number = 0 And Not xmlComment Is Nothing Then
        parentNode.appendChild xmlComment
    End If
    On Error GoTo 0
End Sub

' ==============================================================================
' SafeAppendCData(xmlDoc, parentNode, cdataStr)
' Safely creates and appends a CDATA section, falling back to a text node if
' CDATA creation fails.
' ==============================================================================
Sub SafeAppendCData(xmlDoc, parentNode, cdataStr)
    If parentNode Is Nothing Then Exit Sub
    Dim clean, xmlCdata
    clean = SanitizeXmlText(cdataStr)
    clean = Replace(clean, "]]>", "]] >")

    On Error Resume Next
    Err.Clear
    Set xmlCdata = xmlDoc.createCDATASection(clean)
    If Err.Number = 0 And Not xmlCdata Is Nothing Then
        parentNode.appendChild xmlCdata
    Else
        Err.Clear
        SafeAppendTextNode xmlDoc, parentNode, clean
    End If
    On Error GoTo 0
End Sub

' ==============================================================================
' DecodeHtmlEntities(rawText)
' Decodes named and numeric HTML entities into plain characters.
' ==============================================================================
Function DecodeHtmlEntities(rawText)
    If Len(rawText) = 0 Then
        DecodeHtmlEntities = ""
        Exit Function
    End If
    If InStr(rawText, "&") = 0 Then
        DecodeHtmlEntities = rawText
        Exit Function
    End If

    Dim txt
    txt = rawText
    ' Replace non-breaking space with standard ASCII space (code 32)
    ' This prevents character encoding conversion errors in Shift_JIS (U+00A0 does not exist in CP932)
    txt = Replace(txt, "&nbsp;", " ")
    txt = Replace(txt, "&copy;", "(C)")
    txt = Replace(txt, "&reg;", "(R)")
    txt = Replace(txt, "&trade;", "(TM)")
    txt = Replace(txt, "&mdash;", " - ")
    txt = Replace(txt, "&ndash;", "-")
    txt = Replace(txt, "&hellip;", "...")
    txt = Replace(txt, "&bull;", "*")
    txt = Replace(txt, "&middot;", ".")
    txt = Replace(txt, "&laquo;", "<<")
    txt = Replace(txt, "&raquo;", ">>")
    txt = Replace(txt, "&euro;", "EUR")
    txt = Replace(txt, "&yen;", ChrW(165))
    txt = Replace(txt, "&pound;", "GBP")
    txt = Replace(txt, "&cent;", "cent")
    txt = Replace(txt, "&quot;", """")
    txt = Replace(txt, "&apos;", "'")
    txt = Replace(txt, "&lt;", "<")
    txt = Replace(txt, "&gt;", ">")
    txt = Replace(txt, "&amp;", "&")

    If InStr(txt, "&#") > 0 Then
        Dim reNum, matches, m, numVal, codeVal
        Set reNum = CreateObject("VBScript.RegExp")
        reNum.Global = True
        reNum.IgnoreCase = True

        ' Decimal entities: &#123;
        reNum.Pattern = "&#([0-9]+);"
        Set matches = reNum.Execute(txt)
        For Each m In matches
            numVal = CLng(m.SubMatches(0))
            If numVal = 160 Then
                txt = Replace(txt, m.Value, " ")
            ElseIf numVal = 9 Or numVal = 10 Or numVal = 13 Or (numVal >= 32 And numVal < 55296) Or (numVal >= 57344 And numVal <= 65533) Then
                txt = Replace(txt, m.Value, ChrW(numVal))
            Else
                ' Control character entity like &#0; or &#12; -> replace with space
                txt = Replace(txt, m.Value, " ")
            End If
        Next

        ' Hexadecimal entities: &#x1f;
        reNum.Pattern = "&#x([0-9a-fA-F]+);"
        Set matches = reNum.Execute(txt)
        For Each m In matches
            On Error Resume Next
            codeVal = CLng("&H" & m.SubMatches(0))
            If Err.Number = 0 Then
                If codeVal = 160 Then
                    txt = Replace(txt, m.Value, " ")
                ElseIf codeVal = 9 Or codeVal = 10 Or codeVal = 13 Or (codeVal >= 32 And codeVal < 55296) Or (codeVal >= 57344 And codeVal <= 65533) Then
                    txt = Replace(txt, m.Value, ChrW(codeVal))
                Else
                    txt = Replace(txt, m.Value, " ")
                End If
            End If
            Err.Clear
            On Error GoTo 0
        Next
        Set reNum = Nothing
    End If

    DecodeHtmlEntities = txt
End Function

' ==============================================================================
' ParseHtmlAttributes(attrString, xmlElem, xmlDoc)
' Parses HTML tag attribute string and sets sanitized attributes on xmlElem.
' ==============================================================================
Sub ParseHtmlAttributes(attrString, xmlElem, xmlDoc)
    If Len(Trim(attrString)) = 0 Then Exit Sub

    Dim reAttr, matches, m, aName, aVal, hasEq
    Set reAttr = CreateObject("VBScript.RegExp")
    reAttr.Global = True
    reAttr.IgnoreCase = True
    reAttr.Pattern = "([a-zA-Z0-9_\-:]+)(?:\s*=\s*(?:""([^""]*)""|'([^']*)'|([^\s>]+)))?"
    Set matches = reAttr.Execute(attrString)

    For Each m In matches
        aName = SanitizeXmlName(LCase(m.SubMatches(0)))
        If Len(aName) > 0 Then
            hasEq = (InStr(m.Value, "=") > 0)
            If Not hasEq Then
                aVal = aName
            ElseIf InStr(m.Value, """") > 0 Then
                aVal = DecodeHtmlEntities(CStr(m.SubMatches(1)))
            ElseIf InStr(m.Value, "'") > 0 Then
                aVal = DecodeHtmlEntities(CStr(m.SubMatches(2)))
            ElseIf Not IsEmpty(m.SubMatches(3)) Then
                aVal = DecodeHtmlEntities(CStr(m.SubMatches(3)))
            Else
                aVal = ""
            End If

            aVal = SanitizeXmlText(aVal)

            On Error Resume Next
            xmlElem.setAttribute aName, aVal
            If Err.Number <> 0 Then
                Err.Clear
                If InStr(aName, ":") > 0 Then
                    aName = Replace(aName, ":", "_")
                    xmlElem.setAttribute aName, aVal
                    If Err.Number <> 0 Then Err.Clear
                End If
            End If
            On Error GoTo 0
        End If
    Next
    Set reAttr = Nothing
End Sub

' ==============================================================================
' ConvertHtmlToXml(htmlContent, charset)
' Parses HTML string using a pure VBScript tokenizer and constructs a well-formed
' XML DOM using MSXML2.DOMDocument, returning the serialized XML string.
' ==============================================================================
Function ConvertHtmlToXml(htmlContent, charset)
    Dim xmlDoc, pi, xmlRoot
    Dim curPos, htmlLen, ltPos, textChunk
    Dim endPos, commentText, cdataText
    Dim inQuote, qChar, p, ch, tagEndPos, tagContent, isSelfClosing
    Dim spacePos, tagName, attrStr, xmlElem, currentElem
    Dim closeTagName, targetIdx, j, closeTagPat, closePos, closeEndPos, rawBlock
    Dim xmlResult, endPi, piText
    Dim elemStack(), stackNames(), stackCount, stackCap

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

    On Error Resume Next
    Set pi = xmlDoc.createProcessingInstruction("xml", "version=""1.0"" encoding=""" & charset & """")
    If Not pi Is Nothing Then xmlDoc.appendChild pi
    On Error GoTo 0

    Set xmlRoot = xmlDoc.createElement("html")
    xmlDoc.appendChild xmlRoot

    ' Initialize element stack with root <html>
    stackCap = 64
    ReDim elemStack(stackCap)
    ReDim stackNames(stackCap)
    Set elemStack(0) = xmlRoot
    stackNames(0) = "html"
    stackCount = 1

    curPos = 1
    htmlLen = Len(htmlContent)

    Do While curPos <= htmlLen
        ltPos = InStr(curPos, htmlContent, "<")
        If ltPos = 0 Then
            textChunk = DecodeHtmlEntities(Mid(htmlContent, curPos))
            If Len(Trim(textChunk)) > 0 Then
                Set currentElem = elemStack(stackCount - 1)
                SafeAppendTextNode xmlDoc, currentElem, textChunk
            End If
            Exit Do
        End If

        If ltPos > curPos Then
            textChunk = DecodeHtmlEntities(Mid(htmlContent, curPos, ltPos - curPos))
            If Len(textChunk) > 0 Then
                Set currentElem = elemStack(stackCount - 1)
                SafeAppendTextNode xmlDoc, currentElem, textChunk
            End If
        End If

        curPos = ltPos

        ' 1. Comment <!-- ... -->
        If Mid(htmlContent, curPos, 4) = "<!--" Then
            endPos = InStr(curPos + 4, htmlContent, "-->")
            If endPos > 0 Then
                commentText = Mid(htmlContent, curPos + 4, endPos - (curPos + 4))
                Set currentElem = elemStack(stackCount - 1)
                SafeAppendComment xmlDoc, currentElem, commentText
                curPos = endPos + 3
            Else
                curPos = htmlLen + 1
            End If

        ' 2. Doctype <!DOCTYPE ...> or CDATA <![CDATA[ ... ]]>
        ElseIf UCase(Mid(htmlContent, curPos, 9)) = "<!DOCTYPE" Then
            endPos = InStr(curPos + 9, htmlContent, ">")
            If endPos > 0 Then
                curPos = endPos + 1
            Else
                curPos = htmlLen + 1
            End If

        ElseIf UCase(Mid(htmlContent, curPos, 9)) = "<![CDATA[" Then
            endPos = InStr(curPos + 9, htmlContent, "]]>")
            If endPos > 0 Then
                cdataText = Mid(htmlContent, curPos + 9, endPos - (curPos + 9))
                Set currentElem = elemStack(stackCount - 1)
                SafeAppendCData xmlDoc, currentElem, cdataText
                curPos = endPos + 3
            Else
                curPos = htmlLen + 1
            End If

        ' 3. Processing Instruction <? ... ?>
        ElseIf Mid(htmlContent, curPos, 2) = "<?" Then
            endPos = InStr(curPos + 2, htmlContent, "?>")
            If endPos > 0 Then
                curPos = endPos + 2
            Else
                curPos = htmlLen + 1
            End If

        ' 4. End tag </tag>
        ElseIf Mid(htmlContent, curPos, 2) = "</" Then
            endPos = InStr(curPos + 2, htmlContent, ">")
            If endPos > 0 Then
                closeTagName = SanitizeXmlName(LCase(Trim(Mid(htmlContent, curPos + 2, endPos - (curPos + 2)))))
                curPos = endPos + 1

                If Len(closeTagName) > 0 Then
                    If closeTagName = "html" Then
                        Do While stackCount > 1
                            stackCount = stackCount - 1
                            Set elemStack(stackCount) = Nothing
                            stackNames(stackCount) = ""
                        Loop
                    Else
                        targetIdx = -1
                        For j = stackCount - 1 To 1 Step -1
                            If LCase(stackNames(j)) = closeTagName Then
                                targetIdx = j
                                Exit For
                            End If
                        Next
                        If targetIdx >= 1 Then
                            Do While stackCount > targetIdx
                                stackCount = stackCount - 1
                                Set elemStack(stackCount) = Nothing
                                stackNames(stackCount) = ""
                            Loop
                        End If
                    End If
                End If
            Else
                curPos = htmlLen + 1
            End If

        ' 5. Start tag <tag ...>
        Else
            inQuote = False
            qChar = ""
            tagEndPos = 0
            For p = curPos + 1 To htmlLen
                ch = Mid(htmlContent, p, 1)
                If inQuote Then
                    If ch = qChar Then inQuote = False
                Else
                    If ch = """" Or ch = "'" Then
                        inQuote = True
                        qChar = ch
                    ElseIf ch = ">" Then
                        tagEndPos = p
                        Exit For
                    End If
                End If
            Next

            If tagEndPos = 0 Then
                textChunk = DecodeHtmlEntities(Mid(htmlContent, curPos))
                If Len(Trim(textChunk)) > 0 Then
                    Set currentElem = elemStack(stackCount - 1)
                    SafeAppendTextNode xmlDoc, currentElem, textChunk
                End If
                Exit Do
            End If

            tagContent = Trim(Mid(htmlContent, curPos + 1, tagEndPos - curPos - 1))
            curPos = tagEndPos + 1

            isSelfClosing = False
            If Right(tagContent, 1) = "/" Then
                isSelfClosing = True
                tagContent = Trim(Left(tagContent, Len(tagContent) - 1))
            End If

            spacePos = InStr(tagContent, " ")
            If spacePos = 0 Then spacePos = InStr(tagContent, vbTab)
            If spacePos = 0 Then spacePos = InStr(tagContent, vbCr)
            If spacePos = 0 Then spacePos = InStr(tagContent, vbLf)

            If spacePos > 0 Then
                tagName = SanitizeXmlName(LCase(Left(tagContent, spacePos - 1)))
                attrStr = Mid(tagContent, spacePos + 1)
            Else
                tagName = SanitizeXmlName(LCase(tagContent))
                attrStr = ""
            End If

            If Len(tagName) > 0 Then
                If (tagName = "script" Or tagName = "style") And Not isSelfClosing Then
                    closeTagPat = "</" & tagName & ">"
                    closePos = InStr(curPos, LCase(htmlContent), closeTagPat)
                    rawBlock = ""
                    If closePos > 0 Then
                        rawBlock = Mid(htmlContent, curPos, closePos - curPos)
                        closeEndPos = InStr(closePos, htmlContent, ">")
                        If closeEndPos > 0 Then
                            curPos = closeEndPos + 1
                        Else
                            curPos = closePos + Len(closeTagPat)
                        End If
                    Else
                        rawBlock = Mid(htmlContent, curPos)
                        curPos = htmlLen + 1
                    End If

                    Set xmlElem = xmlDoc.createElement(tagName)
                    ParseHtmlAttributes attrStr, xmlElem, xmlDoc
                    If Len(rawBlock) > 0 Then
                        SafeAppendCData xmlDoc, xmlElem, rawBlock
                    End If
                    Set currentElem = elemStack(stackCount - 1)
                    currentElem.appendChild xmlElem

                ElseIf tagName = "html" And stackCount = 1 Then
                    ParseHtmlAttributes attrStr, xmlRoot, xmlDoc

                Else
                    If stackCount > 1 Then
                        If ShouldAutoClose(stackNames(stackCount - 1), tagName) Then
                            stackCount = stackCount - 1
                            Set elemStack(stackCount) = Nothing
                            stackNames(stackCount) = ""
                        End If
                    End If

                    Set xmlElem = xmlDoc.createElement(tagName)
                    ParseHtmlAttributes attrStr, xmlElem, xmlDoc

                    Set currentElem = elemStack(stackCount - 1)
                    currentElem.appendChild xmlElem

                    If Not isSelfClosing And Not IsVoidTag(tagName) Then
                        If stackCount >= stackCap Then
                            stackCap = stackCap * 2
                            ReDim Preserve elemStack(stackCap)
                            ReDim Preserve stackNames(stackCap)
                        End If
                        Set elemStack(stackCount) = xmlElem
                        stackNames(stackCount) = tagName
                        stackCount = stackCount + 1
                    End If
                End If
            End If
        End If
    Loop

    ' Serialize XML defensively
    On Error Resume Next
    Err.Clear
    xmlResult = xmlDoc.xml
    If Err.Number <> 0 Then
        Err.Clear
        If Not pi Is Nothing Then
            xmlDoc.removeChild pi
            Set pi = Nothing
        End If
        xmlResult = xmlDoc.xml
    End If
    On Error GoTo 0

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

    For j = 0 To stackCount - 1
        Set elemStack(j) = Nothing
    Next
    Set xmlRoot = Nothing
    Set xmlDoc = Nothing
End Function

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
        If Left(filePath, 1) = """" And Right(filePath, 1) = """" And Len(filePath) >= 2 Then
            filePath = Mid(filePath, 2, Len(filePath) - 2)
        End If

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
