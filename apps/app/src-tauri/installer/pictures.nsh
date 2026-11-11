; Snappy's wizard pictures on a scaled display (included by hooks.nsh).
;
; The wizard shows its two pictures in controls sized in dialog units, so on a display at 125%, 150% or 200%
; the controls are larger than the 150 x 57 and 164 x 314 pixel files. NSIS fits a picture to its control with
; LoadImage, which copies pixels without smoothing: some rows and columns are doubled (at 150%, every other
; one) and the logo comes out jagged and soft. So when the display is scaled this file does the fit itself,
; once, when the wizard opens: it shrinks the 3x pictures (header-3x.bmp and sidebar-3x.bmp, drawn by
; tools/make-installer-images.mjs) to the exact size of the control with the smoothing filter of Windows
; (StretchBlt in HALFTONE mode), writes that as a bitmap file and hands it to the wizard, which then has
; nothing left to stretch. At 100% nothing runs and the 1x pictures show as they are drawn. If any step
; fails, the wizard keeps the 1x pictures, as it did before.
;
; Needs LogicLib and the System plugin, which Tauri's template already includes.

!define SNAPPY_PICTURES_DIR "${__FILEDIR__}"

; MUI runs this when the wizard window opens (a hook the template does not use).
!define MUI_CUSTOMFUNCTION_GUIINIT SnappyPictures

Var snW
Var snH
Var snDx
Var snDy
Var snDw
Var snDh
Var snSrc ; the source bitmap
Var snScreen ; the screen's device context
Var snSrcDc
Var snSrcOld
Var snDst ; the new bitmap
Var snDstDc
Var snDstOld
Var snBrush
Var snRect
Var snHead ; the file and bitmap headers
Var snBuf ; the rows of pixels
Var snRows ; their size in bytes
Var snFile
Var snOk

; Writes a 24-bit bitmap file of exactly width x height pixels, made from another bitmap file.
; In (pushed in this order, so the source file is pushed last): the output file, the mode, the height, the
; width, the source file. The mode is 0 to fit the whole source picture inside and centre it (the ground
; colour, taken from the source's top left pixel, fills the rest) or 1 to fit the source's width and keep its
; bottom edge (the top is cropped, or filled with the ground colour). Out: 1 if the file was written, else 0.
Function SnappyScaledBmp
  System::Store "S"
  Pop $0 ; source file
  Pop $1 ; width
  Pop $2 ; height
  Pop $3 ; mode
  Pop $4 ; output file
  StrCpy $snSrc 0
  StrCpy $snScreen 0
  StrCpy $snSrcDc 0
  StrCpy $snSrcOld 0
  StrCpy $snDst 0
  StrCpy $snDstDc 0
  StrCpy $snDstOld 0
  StrCpy $snBrush 0
  StrCpy $snRect 0
  StrCpy $snHead 0
  StrCpy $snBuf 0
  StrCpy $snOk 0

  ${If} $1 < 16
  ${OrIf} $2 < 16
  ${OrIf} $1 > 4000
  ${OrIf} $2 > 4000
    Goto finished
  ${EndIf}

  ; The source and its size.
  System::Call 'user32::LoadImage(p 0, t r0, i 0, i 0, i 0, i 0x10) p .r5'
  StrCpy $snSrc $5
  ${If} $snSrc P= 0
    Goto finished
  ${EndIf}
  System::Alloc 64
  Pop $5
  System::Call 'gdi32::GetObject(p $snSrc, i 32, p r5)'
  System::Call '*$5(i, i .r6, i .r7)'
  System::Free $5
  StrCpy $snW $6
  StrCpy $snH $7
  ${If} $snW < 1
  ${OrIf} $snH < 1
    Goto cleanup
  ${EndIf}

  ; Where the source goes in the new bitmap.
  IntOp $5 $snH * $1 ; height x width
  IntOp $6 $snW * $2 ; width x height
  ${If} $3 = 1
  ${OrIf} $5 <= $6
    StrCpy $snDw $1
    IntOp $snDh $snH * $1
    IntOp $snDh $snDh + $snW
    IntOp $snDh $snDh / $snW ; rounded to the nearest pixel
  ${Else}
    StrCpy $snDh $2
    IntOp $snDw $snW * $2
    IntOp $snDw $snDw + $snH
    IntOp $snDw $snDw / $snH
  ${EndIf}
  ${If} $3 = 1
    StrCpy $snDx 0
    IntOp $snDy $2 - $snDh
  ${Else}
    IntOp $snDx $1 - $snDw
    IntOp $snDx $snDx / 2
    IntOp $snDy $2 - $snDh
    IntOp $snDy $snDy / 2
  ${EndIf}

  ; Draw it: the ground colour over the whole bitmap, then the picture, shrunk with the smoothing filter.
  System::Call 'user32::GetDC(p 0) p .r5'
  StrCpy $snScreen $5
  System::Call 'gdi32::CreateCompatibleDC(p $snScreen) p .r5'
  StrCpy $snSrcDc $5
  System::Call 'gdi32::SelectObject(p $snSrcDc, p $snSrc) p .r5'
  StrCpy $snSrcOld $5
  System::Call 'gdi32::GetPixel(p $snSrcDc, i 0, i 0) i .r5'
  System::Call 'gdi32::CreateSolidBrush(i r5) p .r6'
  StrCpy $snBrush $6
  System::Call 'gdi32::CreateCompatibleBitmap(p $snScreen, i r1, i r2) p .r5'
  StrCpy $snDst $5
  System::Call 'gdi32::CreateCompatibleDC(p $snScreen) p .r5'
  StrCpy $snDstDc $5
  ${If} $snDst P= 0
  ${OrIf} $snDstDc P= 0
  ${OrIf} $snSrcDc P= 0
  ${OrIf} $snBrush P= 0
    Goto cleanup
  ${EndIf}
  System::Call 'gdi32::SelectObject(p $snDstDc, p $snDst) p .r5'
  StrCpy $snDstOld $5
  System::Call '*(i 0, i 0, i r1, i r2) p .r5'
  StrCpy $snRect $5
  System::Call 'user32::FillRect(p $snDstDc, p $snRect, p $snBrush) i .r5'
  System::Call 'gdi32::SetStretchBltMode(p $snDstDc, i 4) i .r5'
  System::Call 'gdi32::SetBrushOrgEx(p $snDstDc, i 0, i 0, p 0) i .r5'
  System::Call 'gdi32::StretchBlt(p $snDstDc, i $snDx, i $snDy, i $snDw, i $snDh, p $snSrcDc, i 0, i 0, i $snW, i $snH, i 0xCC0020) i .r5'
  ${If} $5 = 0
    Goto cleanup
  ${EndIf}
  ; A bitmap has to be out of its device context to be read.
  System::Call 'gdi32::SelectObject(p $snDstDc, p $snDstOld) p .r5'

  ; Read its pixels as a 24-bit bottom-up bitmap and write the file: the 14-byte file header, the 40-byte
  ; bitmap header, then the rows, each padded to four bytes.
  IntOp $5 $1 * 3
  IntOp $5 $5 + 3
  IntOp $5 $5 / 4
  IntOp $5 $5 * 4
  IntOp $snRows $5 * $2
  IntOp $5 $snRows + 54 ; bytes of the whole file
  System::Call '*(&i2 0x4D42, i r5, &i2 0, &i2 0, i 54, i 40, i r1, i r2, &i2 1, &i2 24, i 0, i $snRows, i 2835, i 2835, i 0, i 0) p .r6'
  StrCpy $snHead $6
  System::Alloc $snRows
  Pop $snBuf
  ${If} $snHead P= 0
  ${OrIf} $snBuf P= 0
    Goto cleanup
  ${EndIf}
  IntOp $5 $snHead + 14 ; the bitmap header inside the file header
  System::Call 'gdi32::GetDIBits(p $snScreen, p $snDst, i 0, i r2, p $snBuf, p r5, i 0) i .r6'
  ${If} $6 <> $2
    Goto cleanup
  ${EndIf}
  System::Call 'kernel32::CreateFile(t r4, i 0x40000000, i 0, p 0, i 2, i 0x80, p 0) i .r5'
  StrCpy $snFile $5
  ${If} $snFile <> -1
    System::Call 'kernel32::WriteFile(i $snFile, p $snHead, i 54, *i .r5, p 0) i .r6'
    System::Call 'kernel32::WriteFile(i $snFile, p $snBuf, i $snRows, *i .r7, p 0) i .r8'
    ${If} $6 = 1
    ${AndIf} $8 = 1
    ${AndIf} $7 = $snRows
      StrCpy $snOk 1
    ${EndIf}
    System::Call 'kernel32::CloseHandle(i $snFile)'
  ${EndIf}

  cleanup:
  ${If} $snBuf P<> 0
    System::Free $snBuf
  ${EndIf}
  ${If} $snHead P<> 0
    System::Free $snHead
  ${EndIf}
  ${If} $snRect P<> 0
    System::Free $snRect
  ${EndIf}
  ${If} $snBrush P<> 0
    System::Call 'gdi32::DeleteObject(p $snBrush)'
  ${EndIf}
  ${If} $snDstDc P<> 0
    System::Call 'gdi32::DeleteDC(p $snDstDc)'
  ${EndIf}
  ${If} $snDst P<> 0
    System::Call 'gdi32::DeleteObject(p $snDst)'
  ${EndIf}
  ${If} $snSrcDc P<> 0
    System::Call 'gdi32::DeleteDC(p $snSrcDc)'
  ${EndIf}
  ${If} $snSrc P<> 0
    System::Call 'gdi32::DeleteObject(p $snSrc)'
  ${EndIf}
  ${If} $snScreen P<> 0
    System::Call 'user32::ReleaseDC(p 0, p $snScreen)'
  ${EndIf}
  finished:
  Push $snOk
  System::Store "L"
FunctionEnd

; MUI calls this when the wizard window opens, after it has loaded the 1x pictures.
Function SnappyPictures
  System::Store "S"
  StrCpy $0 0
  System::Call 'user32::GetDpiForWindow(p $HWNDPARENT) i .r0'
  ${If} $0 > 96
    InitPluginsDir
    File "/oname=$PLUGINSDIR\snappy-header-3x.bmp" "${SNAPPY_PICTURES_DIR}\header-3x.bmp"
    File "/oname=$PLUGINSDIR\snappy-sidebar-3x.bmp" "${SNAPPY_PICTURES_DIR}\sidebar-3x.bmp"

    ; The strip at the top of the inner pages: the size of its control is read as it is.
    GetDlgItem $1 $HWNDPARENT 1046
    System::Call 'user32::GetClientRect(p r1, @ r2)'
    System::Call '*$2(i, i, i .r3, i .r4)'
    Push "$PLUGINSDIR\snappy-header.bmp"
    Push 0
    Push $4
    Push $3
    Push "$PLUGINSDIR\snappy-header-3x.bmp"
    Call SnappyScaledBmp
    Pop $5
    ${If} $5 = 1
      SetBrandingImage /IMGID=1046 /RESIZETOFIT "$PLUGINSDIR\snappy-header.bmp"
    ${EndIf}

    ; The side of the Welcome and Finish pages: its control is 109 x 193 dialog units, the unit being
    ; the wizard window's own. The wizard loads the file below when it opens each of those pages.
    System::Call '*(i 0, i 0, i 109, i 193) p .r2'
    System::Call 'user32::MapDialogRect(p $HWNDPARENT, p r2) i .r5'
    System::Call '*$2(i, i, i .r3, i .r4)'
    System::Free $2
    Push "$PLUGINSDIR\snappy-wizard.bmp"
    Push 1
    Push $4
    Push $3
    Push "$PLUGINSDIR\snappy-sidebar-3x.bmp"
    Call SnappyScaledBmp
    Pop $5
    ${If} $5 = 1
      CopyFiles /SILENT "$PLUGINSDIR\snappy-wizard.bmp" "$PLUGINSDIR\modern-wizard.bmp"
    ${EndIf}
  ${EndIf}
  System::Store "L"
FunctionEnd
