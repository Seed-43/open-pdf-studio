; ============================================================
; Look and feel of the installer and the uninstaller
;
; Flat, light pages in the colours of the app (styles/themes.css): white
; content, the dark app colour behind the logo on the welcome and finish
; pages, the amber accent as the line under the header and on the progress
; bar, and Segoe UI as the dialog font.
;
; - Welcome and finish are stock Modern UI pages, laid out again in their
;   SHOW callbacks (logo, version, one-line description, license link).
; - Options (installer only) holds the install location and the choices that
;   used to be pages of their own: PDF files, printer, shortcuts. The states
;   it leaves are read by NSIS_HOOK_POSTINSTALL (hooks.nsh) and the Install
;   section (installer.nsi).
;
; Artwork: art/*.bmp, made by art/generate-art.py. There is one bitmap per
; DPI; the one for the DPI of the window is shown unscaled, centred in its
; control, on a background of the same colour (OpdsSetArt). Stretching a
; single bitmap made it blurry at 150 % and more.
;
; Helpers keep their values in the Opds* variables below and leave the
; registers alone: PageReinstall and PageLeaveReinstall in installer.nsi keep
; state in $R0-$R6 across calls to them.
; ============================================================

!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "WinMessages.nsh"

!define OPDS_ART_DIR "${__FILEDIR__}\art"

; Brand colours, from styles/themes.css (default theme).
!define OPDS_COLOR_DARK "36363E"
!define OPDS_COLOR_ACCENT "D97706"
; Text on white: near-black, muted grey and a darker amber for links (the
; accent itself is too light for small text on white).
!define OPDS_COLOR_TEXT "1F1F24"
!define OPDS_COLOR_MUTED "5F5F69"
!define OPDS_COLOR_LINK "B45309"
!define OPDS_COLOR_PAGE "FFFFFF"

!define OPDS_LICENSE_URL "https://github.com/OpenAEC-Foundation/OpenPDFStudio/blob/main/LICENSE.md"

; Size the installed files take, for the options page. ESTIMATEDSIZE is in KB.
!define /math OPDS_SIZE_MB ${ESTIMATEDSIZE} / 1024

SetFont "Segoe UI" 9
InstProgressFlags smooth

; Modern UI settings. The bitmaps given here are the 100 % ones; the pages
; replace them with the one for the window's DPI.
!define MUI_WELCOMEFINISHPAGE_BITMAP "${OPDS_ART_DIR}\sidebar-96.bmp"
!define MUI_WELCOMEFINISHPAGE_BITMAP_STRETCH NoStretchNoCropNoAlign
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "${OPDS_ART_DIR}\sidebar-96.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP_STRETCH NoStretchNoCropNoAlign
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_RIGHT
!define MUI_HEADERIMAGE_BITMAP "${OPDS_ART_DIR}\header-96.bmp"
!define MUI_HEADERIMAGE_BITMAP_STRETCH NoStretchNoCropNoAlign
!define MUI_CUSTOMFUNCTION_GUIINIT OpdsGuiInit
!define MUI_CUSTOMFUNCTION_UNGUIINIT un.OpdsGuiInit

; Extracted in the GUI init functions: keep them at the front of the data.
!macro OPDS_RESERVE_ART DPI
  ReserveFile "${OPDS_ART_DIR}\sidebar-${DPI}.bmp"
  ReserveFile "${OPDS_ART_DIR}\header-${DPI}.bmp"
!macroend
!insertmacro OPDS_RESERVE_ART 96
!insertmacro OPDS_RESERVE_ART 120
!insertmacro OPDS_RESERVE_ART 144
!insertmacro OPDS_RESERVE_ART 168
!insertmacro OPDS_RESERVE_ART 192

Var OpdsWinDpi     ; DPI of the window when it was created
Var OpdsDpi        ; DPI the artwork is picked for (OpdsPickDpi)
Var OpdsCtl        ; control a helper works on
Var OpdsFile       ; bitmap file for OpdsSetArt
Var OpdsBitmap     ; bitmap OpdsSetArt put in the control
Var OpdsX          ; position for OpdsPlace, in dialog units
Var OpdsY
Var OpdsW
Var OpdsH
Var OpdsTmp
Var OpdsTitleFont
Var OpdsAccentLine ; amber line under the header
Var OpdsBand       ; white around the page area
Var OpdsHeaderImage ; logo on the right of the header
Var OpdsHeaderFont
Var OpdsHeadingFont

; Options page
Var OpdsOptionsSeen
Var OpdsDirField
Var StartMenuShortcutCheckbox
Var StartMenuShortcutState

!macro OPDS_EXTRACT_ART DPI
  File "/oname=$PLUGINSDIR\opds-${DPI}-sidebar.bmp" "${OPDS_ART_DIR}\sidebar-${DPI}.bmp"
  File "/oname=$PLUGINSDIR\opds-${DPI}-header.bmp" "${OPDS_ART_DIR}\header-${DPI}.bmp"
!macroend

; A font of _PT points for the DPI of the window (CreateFont would take the
; DPI of the primary screen).
!macro OPDS_FONT _VAR _FACE _PT _WEIGHT
  IntOp $OpdsTmp ${_PT} * $OpdsWinDpi
  IntOp $OpdsTmp $OpdsTmp / 72
  IntOp $OpdsTmp 0 - $OpdsTmp
  System::Call 'gdi32::CreateFontW(i $OpdsTmp, i 0, i 0, i 0, i ${_WEIGHT}, i 0, i 0, i 0, i 1, i 0, i 0, i 5, i 0, w "${_FACE}") p .s'
  Pop ${_VAR}
!macroend

!macro OPDS_PLACE _UN _CTL _X _Y _W _H
  StrCpy $OpdsCtl ${_CTL}
  StrCpy $OpdsX ${_X}
  StrCpy $OpdsY ${_Y}
  StrCpy $OpdsW ${_W}
  StrCpy $OpdsH ${_H}
  Call ${_UN}OpdsPlace
!macroend

; Title, accent rule and body text of a welcome or finish page, in the right
; column next to the sidebar. Hides the title and text Modern UI made. The
; welcome page has the version under a one-line title; the finish pages leave
; room for a title of two lines.
!macro OPDS_FULLPAGE_TEXTS _MUITITLE _MUITEXT _TITLE _TITLEHEIGHT _TEXT _TEXTTOP
  ShowWindow ${_MUITITLE} ${SW_HIDE}
  ShowWindow ${_MUITEXT} ${SW_HIDE}
  ${NSD_CreateLabel} 120u 16u 190u ${_TITLEHEIGHT}u "${_TITLE}"
  Pop $OpdsCtl
  SetCtlColors $OpdsCtl "${OPDS_COLOR_TEXT}" "${OPDS_COLOR_PAGE}"
  SendMessage $OpdsCtl ${WM_SETFONT} $OpdsTitleFont 0
  ${NSD_CreateLabel} 120u 52u 16u 1u ""
  Pop $OpdsCtl
  SetCtlColors $OpdsCtl "" "${OPDS_COLOR_ACCENT}"
  ${NSD_CreateLabel} 120u ${_TEXTTOP}u 190u 30u "${_TEXT}"
  Pop $OpdsCtl
  SetCtlColors $OpdsCtl "${OPDS_COLOR_TEXT}" "${OPDS_COLOR_PAGE}"
!macroend

; Helpers for both the installer and the uninstaller.
!macro OPDS_UI_HELPERS _UN

; Moves and sizes $OpdsCtl to $OpdsX $OpdsY $OpdsW $OpdsH dialog units (the
; units of the installer window, which every page shares).
Function ${_UN}OpdsPlace
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  System::Call '*(i $OpdsX, i $OpdsY, i $OpdsW, i $OpdsH) p .r4'
  System::Call 'user32::MapDialogRect(p $HWNDPARENT, p r4)'
  System::Call '*$4(i .r0, i .r1, i .r2, i .r3)'
  System::Free $4
  System::Call 'user32::SetWindowPos(p $OpdsCtl, p 0, i r0, i r1, i r2, i r3, i 0x14)' ; SWP_NOZORDER|SWP_NOACTIVATE
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

; $OpdsDpi = the DPI of the artwork that suits the window now.
Function ${_UN}OpdsPickDpi
  System::Call 'user32::GetDpiForWindow(p $HWNDPARENT) i .s'
  Pop $OpdsDpi
  ${If} $OpdsDpi < 108
    StrCpy $OpdsDpi 96
  ${ElseIf} $OpdsDpi < 132
    StrCpy $OpdsDpi 120
  ${ElseIf} $OpdsDpi < 156
    StrCpy $OpdsDpi 144
  ${ElseIf} $OpdsDpi < 180
    StrCpy $OpdsDpi 168
  ${Else}
    StrCpy $OpdsDpi 192
  ${EndIf}
FunctionEnd

; Shows bitmap file $OpdsFile in the static control $OpdsCtl, unscaled and
; centred; the control keeps its size (SS_CENTERIMAGE). Frees the bitmap the
; control had. Leaves the new bitmap in $OpdsBitmap. The caller sets the
; background colour (SetCtlColors takes no variables).
Function ${_UN}OpdsSetArt
  System::Call 'user32::GetWindowLongW(p $OpdsCtl, i -16) i .s'
  Pop $OpdsTmp
  IntOp $OpdsTmp $OpdsTmp | 0x200 ; SS_CENTERIMAGE
  System::Call 'user32::SetWindowLongW(p $OpdsCtl, i -16, i $OpdsTmp)'
  System::Call 'user32::LoadImageW(p 0, w "$OpdsFile", i 0, i 0, i 0, i 0x10) p .s' ; IMAGE_BITMAP, LR_LOADFROMFILE
  Pop $OpdsBitmap
  SendMessage $OpdsCtl ${STM_SETIMAGE} ${IMAGE_BITMAP} $OpdsBitmap $OpdsTmp
  ${If} $OpdsTmp <> 0
    System::Call 'gdi32::DeleteObject(p $OpdsTmp)'
  ${EndIf}
FunctionEnd

; The header bitmap for the window's DPI. Called on every page with a
; header, so it follows the window to a screen with another scale.
Function ${_UN}OpdsHeaderArt
  ShowWindow $OpdsAccentLine ${SW_SHOW}
  ShowWindow $OpdsBand ${SW_SHOW}
  Call ${_UN}OpdsPickDpi
  StrCpy $OpdsCtl $OpdsHeaderImage
  StrCpy $OpdsFile "$PLUGINSDIR\opds-$OpdsDpi-header.bmp"
  Call ${_UN}OpdsSetArt
  !insertmacro OPDS_PLACE "${_UN}" $OpdsHeaderImage 231 0 100 35
  ShowWindow $OpdsHeaderImage ${SW_SHOW}
  System::Call 'user32::InvalidateRect(p $OpdsHeaderImage, p 0, i 1)'
FunctionEnd

; The sidebar bitmap for the window's DPI in image control $OpdsCtl of a
; welcome or finish page. Leaves the bitmap in $OpdsBitmap: the caller hands
; it to Modern UI, which frees it when the page closes.
Function ${_UN}OpdsSidebarArt
  ; The full-window pages cover the header: the line and the band go.
  ShowWindow $OpdsAccentLine ${SW_HIDE}
  ShowWindow $OpdsBand ${SW_HIDE}
  ShowWindow $OpdsHeaderImage ${SW_HIDE}
  Call ${_UN}OpdsPickDpi
  StrCpy $OpdsFile "$PLUGINSDIR\opds-$OpdsDpi-sidebar.bmp"
  Call ${_UN}OpdsSetArt
  SetCtlColors $OpdsCtl "" "${OPDS_COLOR_DARK}"
  !insertmacro OPDS_PLACE "${_UN}" $OpdsCtl 0 0 109 193
FunctionEnd

Function ${_UN}OpdsGuiInit
  InitPluginsDir
  !insertmacro OPDS_EXTRACT_ART 96
  !insertmacro OPDS_EXTRACT_ART 120
  !insertmacro OPDS_EXTRACT_ART 144
  !insertmacro OPDS_EXTRACT_ART 168
  !insertmacro OPDS_EXTRACT_ART 192

  System::Call 'user32::GetDpiForWindow(p $HWNDPARENT) i .s'
  Pop $OpdsWinDpi
  ${If} $OpdsWinDpi < 96
    StrCpy $OpdsWinDpi 96
  ${EndIf}
  !insertmacro OPDS_FONT $OpdsTitleFont "Segoe UI Semibold" 15 600
  !insertmacro OPDS_FONT $OpdsHeaderFont "Segoe UI Semibold" 11 600
  !insertmacro OPDS_FONT $OpdsHeadingFont "Segoe UI Semibold" 9 600

  ; Header: title in the semibold face, subtitle in grey, both aligned left.
  GetDlgItem $OpdsCtl $HWNDPARENT 1037
  SendMessage $OpdsCtl ${WM_SETFONT} $OpdsHeaderFont 0
  !insertmacro OPDS_PLACE "${_UN}" $OpdsCtl 10 6 215 12
  GetDlgItem $OpdsCtl $HWNDPARENT 1038
  SetCtlColors $OpdsCtl "${OPDS_COLOR_MUTED}" "${OPDS_COLOR_PAGE}"
  !insertmacro OPDS_PLACE "${_UN}" $OpdsCtl 10 19 215 15

  ; The header image, in a control of our own that only this file shows and
  ; hides. Modern UI shows its own (1046) again after a full-window page, and
  ; on the page after the welcome page a new bitmap in it stayed blank.
  ; 1046 stays empty.
  GetDlgItem $OpdsCtl $HWNDPARENT 1046
  SendMessage $OpdsCtl ${STM_SETIMAGE} ${IMAGE_BITMAP} 0 $OpdsTmp
  ${If} $OpdsTmp <> 0
    System::Call 'gdi32::DeleteObject(p $OpdsTmp)'
  ${EndIf}
  System::Call 'user32::SetWindowPos(p $OpdsCtl, p 0, i 0, i 0, i 0, i 0, i 0x16)' ; zero size; SWP_NOMOVE|SWP_NOZORDER|SWP_NOACTIVATE
  System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w "", i 0x4400020E, i 0, i 0, i 0, i 0, p $HWNDPARENT, p 0, p 0, p 0) p .s' ; WS_CHILD|WS_CLIPSIBLINGS|SS_BITMAP|SS_CENTERIMAGE
  Pop $OpdsHeaderImage
  SetCtlColors $OpdsHeaderImage "" "${OPDS_COLOR_PAGE}"
  ; New child windows go to the bottom of the z-order; this one has to be
  ; above the header background (1034), and that background must not paint
  ; over it when it is redrawn (WS_CLIPSIBLINGS).
  System::Call 'user32::SetWindowPos(p $OpdsHeaderImage, p 0, i 0, i 0, i 0, i 0, i 0x13)' ; HWND_TOP; SWP_NOSIZE|SWP_NOMOVE|SWP_NOACTIVATE
  GetDlgItem $OpdsCtl $HWNDPARENT 1034
  System::Call 'user32::GetWindowLongW(p $OpdsCtl, i -16) i .s'
  Pop $OpdsTmp
  IntOp $OpdsTmp $OpdsTmp | 0x04000000 ; WS_CLIPSIBLINGS
  System::Call 'user32::SetWindowLongW(p $OpdsCtl, i -16, i $OpdsTmp)'

  ; The accent line under the header, in place of the etched line (1036).
  GetDlgItem $OpdsCtl $HWNDPARENT 1036
  ShowWindow $OpdsCtl ${SW_HIDE}
  System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w "", i 0x44000000, i 0, i 0, i 0, i 0, p $HWNDPARENT, p 0, p 0, p 0) p .s' ; WS_CHILD|WS_CLIPSIBLINGS
  Pop $OpdsAccentLine
  SetCtlColors $OpdsAccentLine "" "${OPDS_COLOR_ACCENT}"
  !insertmacro OPDS_PLACE "${_UN}" $OpdsAccentLine 0 35 331 1

  ; White around the page area of the pages with a header, from the accent
  ; line to the strip with the buttons. Pages are created later and so lie
  ; below it in the z-order: its window region leaves out the page area
  ; (15u 45u 300u 140u, control 1018) so it never paints over a page, and it
  ; is hidden on the full-window pages. The pages are made white themselves.
  System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w "", i 0x44000000, i 0, i 0, i 0, i 0, p $HWNDPARENT, p 0, p 0, p 0) p .s'
  Pop $OpdsBand
  SetCtlColors $OpdsBand "" "${OPDS_COLOR_PAGE}"
  !insertmacro OPDS_PLACE "${_UN}" $OpdsBand 0 36 331 151
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  Push $7
  System::Call '*(i 0, i 36, i 331, i 187) p .r6' ; the band (left top right bottom)
  System::Call 'user32::MapDialogRect(p $HWNDPARENT, p r6)'
  System::Call '*$6(i, i .r5, i .r4, i .r7)'
  System::Free $6
  IntOp $7 $7 - $5 ; band height
  System::Call '*(i 15, i 45, i 315, i 185) p .r6' ; the page area
  System::Call 'user32::MapDialogRect(p $HWNDPARENT, p r6)'
  System::Call '*$6(i .r0, i .r1, i .r2, i .r3)'
  System::Free $6
  IntOp $1 $1 - $5 ; into band coordinates
  IntOp $3 $3 - $5
  System::Call 'gdi32::CreateRectRgn(i 0, i 0, i r4, i r7) p .r6'
  System::Call 'gdi32::CreateRectRgn(i r0, i r1, i r2, i r3) p .r7'
  System::Call 'gdi32::CombineRgn(p r6, p r6, p r7, i 4)' ; RGN_DIFF
  System::Call 'gdi32::DeleteObject(p r7)'
  System::Call 'user32::SetWindowRgn(p $OpdsBand, p r6, i 1)' ; the window owns the region now
  Pop $7
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0

  Call ${_UN}OpdsHeaderArt
FunctionEnd

; White background for a page Modern UI made from a dialog resource (progress,
; uninstall confirmation): the page itself and its texts, check boxes and
; buttons. Edit and list controls keep their own colours.
Function ${_UN}OpdsWhitePage
  FindWindow $OpdsCtl "#32770" "" $HWNDPARENT
  SetCtlColors $OpdsCtl "" "${OPDS_COLOR_PAGE}"
  StrCpy $OpdsTmp ""
  ${Do}
    FindWindow $OpdsTmp "" "" $OpdsCtl $OpdsTmp
    ${IfThen} $OpdsTmp == 0 ${|} ${Break} ${|}
    System::Call 'user32::GetClassNameW(p $OpdsTmp, w .s, i 64)'
    Pop $OpdsFile
    ${If} $OpdsFile == "Static"
    ${OrIf} $OpdsFile == "Button"
      SetCtlColors $OpdsTmp "" "${OPDS_COLOR_PAGE}"
    ${EndIf}
  ${Loop}
FunctionEnd

; Progress page: white, with a flat bar in the accent colour.
Function ${_UN}OpdsInstFilesShow
  Call ${_UN}OpdsHeaderArt
  Call ${_UN}OpdsWhitePage
  FindWindow $OpdsCtl "#32770" "" $HWNDPARENT
  GetDlgItem $OpdsCtl $OpdsCtl 1004
  System::Call 'uxtheme::SetWindowTheme(p $OpdsCtl, w "", w "")'
  System::Call 'user32::GetWindowLongW(p $OpdsCtl, i -16) i .s'
  Pop $OpdsTmp
  IntOp $OpdsTmp $OpdsTmp & 0xFF7FFFFF ; no WS_BORDER
  System::Call 'user32::SetWindowLongW(p $OpdsCtl, i -16, i $OpdsTmp)'
  System::Call 'user32::SetWindowPos(p $OpdsCtl, p 0, i 0, i 0, i 0, i 0, i 0x37)' ; SWP_FRAMECHANGED|NOMOVE|NOSIZE|NOZORDER|NOACTIVATE
  SendMessage $OpdsCtl ${PBM_SETBARCOLOR} 0 0x000677D9 ; accent, as 0x00BBGGRR
  SendMessage $OpdsCtl ${PBM_SETBKCOLOR} 0 0x00E8E8EA
FunctionEnd

!macroend

!insertmacro OPDS_UI_HELPERS ""
!insertmacro OPDS_UI_HELPERS "un."

; The page functions use variables that the Modern UI page macros declare,
; so installer.nsi inserts them after its page list.
!macro OPDS_UI_PAGE_FUNCTIONS

; ============================================================
; Installer pages
; ============================================================

Function OpdsWelcomeShow
  StrCpy $OpdsCtl $mui.WelcomePage.Image
  Call OpdsSidebarArt
  StrCpy $mui.WelcomePage.Image.Bitmap $OpdsBitmap

  !insertmacro OPDS_FULLPAGE_TEXTS $mui.WelcomePage.Title $mui.WelcomePage.Text "$(opdsWelcomeTitle)" 22 "$(opdsDescription)" 60
  ${NSD_CreateLabel} 120u 38u 190u 10u "$(opdsVersion)"
  Pop $OpdsCtl
  SetCtlColors $OpdsCtl "${OPDS_COLOR_MUTED}" "${OPDS_COLOR_PAGE}"
  ${NSD_CreateLabel} 120u 96u 190u 20u "$(opdsWelcomeNext)"
  Pop $OpdsCtl
  SetCtlColors $OpdsCtl "${OPDS_COLOR_TEXT}" "${OPDS_COLOR_PAGE}"

  ${NSD_CreateLabel} 120u 156u 190u 10u "$(opdsLicenseText)"
  Pop $OpdsCtl
  SetCtlColors $OpdsCtl "${OPDS_COLOR_MUTED}" "${OPDS_COLOR_PAGE}"
  ${NSD_CreateLink} 120u 167u 100u 10u "$(opdsLicenseLink)"
  Pop $OpdsCtl
  SetCtlColors $OpdsCtl "${OPDS_COLOR_LINK}" "${OPDS_COLOR_PAGE}"
  ${NSD_OnClick} $OpdsCtl OpdsOpenLicense
FunctionEnd

; Opens the license in the browser as the signed-in user, not elevated like
; this installer.
Function OpdsOpenLicense
  nsis_tauri_utils::RunAsUser "$WINDIR\explorer.exe" "${OPDS_LICENSE_URL}"
FunctionEnd

; Options: install location, PDF files, printer, shortcuts.
Function OptionsPageCreate
  ${If} $PassiveMode = 1
  ${OrIf} $UpdateMode = 1
    ; As the separate pages did before: the PDF association and the desktop
    ; shortcut stay on; the printer is only brought up to date (hooks.nsh).
    StrCpy $AssocPDFState ${BST_CHECKED}
    StrCpy $DesktopShortcutState ${BST_CHECKED}
    Abort
  ${EndIf}

  ; Defaults on the first visit; after Back and Next the user's choices.
  ${If} $OpdsOptionsSeen != 1
    StrCpy $OpdsOptionsSeen 1
    StrCpy $AssocPDFState ${BST_CHECKED}
    StrCpy $VPrinterState ${BST_CHECKED}
    StrCpy $DesktopShortcutState ${BST_CHECKED}
    StrCpy $StartMenuShortcutState ${BST_CHECKED}
  ${EndIf}

  Call OpdsHeaderArt
  !insertmacro MUI_HEADER_TEXT "$(opdsOptionsTitle)" "$(opdsOptionsSubtitle)"

  nsDialogs::Create 1018
  Pop $OpdsCtl
  ${If} $OpdsCtl == error
    Abort
  ${EndIf}
  ${IfThen} $(^RTL) = 1 ${|} nsDialogs::SetRTL $(^RTL) ${|}
  SetCtlColors $OpdsCtl "" "${OPDS_COLOR_PAGE}"

  ; Install location
  ${NSD_CreateLabel} 0 0 100% 10u "$(opdsLocation)"
  Pop $OpdsCtl
  SetCtlColors $OpdsCtl "${OPDS_COLOR_TEXT}" "${OPDS_COLOR_PAGE}"
  SendMessage $OpdsCtl ${WM_SETFONT} $OpdsHeadingFont 0
  ${NSD_CreateDirRequest} 0 13u 245u 13u "$INSTDIR"
  Pop $OpdsDirField
  ${NSD_CreateBrowseButton} 250u 12u 50u 15u "$(^BrowseBtn)"
  Pop $OpdsCtl
  SetCtlColors $OpdsCtl "" "${OPDS_COLOR_PAGE}"
  ${NSD_OnClick} $OpdsCtl OpdsOptionsBrowse
  ${NSD_CreateLabel} 0 30u 100% 10u "$(^SpaceRequired)${OPDS_SIZE_MB} MB"
  Pop $OpdsCtl
  SetCtlColors $OpdsCtl "${OPDS_COLOR_MUTED}" "${OPDS_COLOR_PAGE}"

  ; Options
  ${NSD_CreateLabel} 0 44u 100% 10u "$(opdsOptions)"
  Pop $OpdsCtl
  SetCtlColors $OpdsCtl "${OPDS_COLOR_TEXT}" "${OPDS_COLOR_PAGE}"
  SendMessage $OpdsCtl ${WM_SETFONT} $OpdsHeadingFont 0

  ${NSD_CreateCheckBox} 0 56u 100% 10u "$(opdsAssoc)"
  Pop $AssocPDFCheckbox
  SetCtlColors $AssocPDFCheckbox "" "${OPDS_COLOR_PAGE}"
  ${NSD_SetState} $AssocPDFCheckbox $AssocPDFState
  ; Windows does not let installers set the default PDF app (the user's
  ; choice is protected); registration only makes the app available.
  ${NSD_CreateLabel} 12u 66u -12u 10u "$(opdsAssocHint)"
  Pop $OpdsCtl
  SetCtlColors $OpdsCtl "${OPDS_COLOR_MUTED}" "${OPDS_COLOR_PAGE}"

  ; The printer needs administrator rights; without them there is no
  ; check box and the rows below move up.
  StrCpy $VPrinterCheckbox ""
  StrCpy $OpdsY 80
  UserInfo::GetAccountType
  Pop $OpdsTmp
  ${If} $OpdsTmp == "Admin"
    ${NSD_CreateCheckBox} 0 80u 100% 10u "$(opdsPrinter)"
    Pop $VPrinterCheckbox
    SetCtlColors $VPrinterCheckbox "" "${OPDS_COLOR_PAGE}"
    ${NSD_SetState} $VPrinterCheckbox $VPrinterState
    ${NSD_CreateLabel} 12u 90u -12u 18u "$(opdsPrinterHint)"
    Pop $OpdsCtl
    SetCtlColors $OpdsCtl "${OPDS_COLOR_MUTED}" "${OPDS_COLOR_PAGE}"
    StrCpy $OpdsY 112
  ${EndIf}

  StrCpy $OpdsTmp "u"
  StrCpy $OpdsX "$OpdsY$OpdsTmp"
  ${NSD_CreateCheckBox} 0 $OpdsX 100% 10u "$(opdsDesktop)"
  Pop $DesktopShortcutCheckbox
  SetCtlColors $DesktopShortcutCheckbox "" "${OPDS_COLOR_PAGE}"
  ${NSD_SetState} $DesktopShortcutCheckbox $DesktopShortcutState
  IntOp $OpdsY $OpdsY + 14
  StrCpy $OpdsX "$OpdsY$OpdsTmp"
  ${NSD_CreateCheckBox} 0 $OpdsX 100% 10u "$(opdsStartMenu)"
  Pop $StartMenuShortcutCheckbox
  SetCtlColors $StartMenuShortcutCheckbox "" "${OPDS_COLOR_PAGE}"
  ${NSD_SetState} $StartMenuShortcutCheckbox $StartMenuShortcutState

  ${NSD_SetFocus} $OpdsDirField
  nsDialogs::Show
FunctionEnd

Function OpdsOptionsBrowse
  ${NSD_GetText} $OpdsDirField $OpdsFile
  nsDialogs::SelectFolderDialog "$(^DirBrowseText)" "$OpdsFile"
  Pop $OpdsFile
  ${If} $OpdsFile == error
    Return
  ${EndIf}
  ; Like the standard directory page: the product folder goes inside the
  ; chosen folder, unless that already is the product folder.
  StrCpy $OpdsTmp $OpdsFile 1 -1
  ${IfThen} $OpdsTmp == "\" ${|} StrCpy $OpdsFile $OpdsFile -1 ${|}
  StrLen $OpdsTmp "${PRODUCTNAME}"
  IntOp $OpdsTmp 0 - $OpdsTmp
  StrCpy $OpdsTmp $OpdsFile "" $OpdsTmp
  ${If} $OpdsTmp != "${PRODUCTNAME}"
    StrCpy $OpdsFile "$OpdsFile\${PRODUCTNAME}"
  ${EndIf}
  ${NSD_SetText} $OpdsDirField $OpdsFile
FunctionEnd

Function OptionsPageLeave
  ${NSD_GetText} $OpdsDirField $OpdsFile
  ; Without a trailing backslash, except for a drive root ("C:\").
  StrLen $OpdsTmp $OpdsFile
  ${If} $OpdsTmp > 3
    StrCpy $OpdsTmp $OpdsFile 1 -1
    ${IfThen} $OpdsTmp == "\" ${|} StrCpy $OpdsFile $OpdsFile -1 ${|}
  ${EndIf}
  ; A full path: "X:\..." or a network path "\\server\share\...".
  StrCpy $OpdsTmp $OpdsFile 2 1
  StrCpy $OpdsX $OpdsFile 2
  ${If} $OpdsTmp != ":\"
  ${AndIf} $OpdsX != "\\"
    MessageBox MB_ICONEXCLAMATION|MB_OK "$(opdsInvalidDir)"
    Abort
  ${EndIf}
  StrCpy $INSTDIR $OpdsFile

  ${NSD_GetState} $AssocPDFCheckbox $AssocPDFState
  ${If} $VPrinterCheckbox != ""
    ${NSD_GetState} $VPrinterCheckbox $VPrinterState
  ${EndIf}
  ${NSD_GetState} $DesktopShortcutCheckbox $DesktopShortcutState
  ${NSD_GetState} $StartMenuShortcutCheckbox $StartMenuShortcutState
FunctionEnd

Function OpdsFinishShow
  StrCpy $OpdsCtl $mui.FinishPage.Image
  Call OpdsSidebarArt
  StrCpy $mui.FinishPage.Image.Bitmap $OpdsBitmap
  ; A reboot question keeps the layout of Modern UI.
  ${If} ${RebootFlag}
    SendMessage $mui.FinishPage.Title ${WM_SETFONT} $OpdsTitleFont 0
    Return
  ${EndIf}
  !insertmacro OPDS_FULLPAGE_TEXTS $mui.FinishPage.Title $mui.FinishPage.Text "$(opdsFinishTitle)" 34 "$(opdsFinishText)" 60
FunctionEnd

; ============================================================
; Uninstaller pages
; ============================================================

; No reboot question on this page (MUI_FINISHPAGE_NOREBOOTSUPPORT).
Function un.OpdsFinishShow
  StrCpy $OpdsCtl $mui.FinishPage.Image
  Call un.OpdsSidebarArt
  StrCpy $mui.FinishPage.Image.Bitmap $OpdsBitmap
  !insertmacro OPDS_FULLPAGE_TEXTS $mui.FinishPage.Title $mui.FinishPage.Text "$(opdsUnFinishTitle)" 34 "$(opdsUnFinishText)" 60
FunctionEnd

!macroend
