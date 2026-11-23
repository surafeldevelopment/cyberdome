; CyberDome Command Center: Windows installer (NSIS 3, MUI2).
; Built by desktop/build.mjs, which passes these defines:
;   /DAPP_VERSION=x.y.z  /DSRC_DIR=<assembled app folder>  /DOUT_FILE=<setup exe path>  /DICON=<icon.ico>
; Machine-wide install into Program Files (Windows asks for permission once).
; Each user's assessment data stays in their own %LOCALAPPDATA%\CyberDome\data.

Unicode true
SetCompressor /SOLID lzma
RequestExecutionLevel admin

!ifndef BMP_DIR
  !define BMP_DIR "."
!endif
!ifndef APP_VERSION
  !define APP_VERSION "1.0.0"
!endif
!define APP_NAME "CyberDome Command Center"
!define APP_SHORT "CyberDome"
!define APP_EXE "CyberDome.exe"
!define PUBLISHER "CyberDome"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\CyberDome"

Name "${APP_NAME}"
OutFile "${OUT_FILE}"
InstallDir "$PROGRAMFILES64\CyberDome"
InstallDirRegKey HKLM "${UNINST_KEY}" "InstallLocation"
BrandingText "${APP_NAME} ${APP_VERSION}"
ShowInstDetails nevershow
ShowUninstDetails nevershow

VIProductVersion "${APP_VERSION}.0"
VIAddVersionKey "ProductName" "${APP_NAME}"
VIAddVersionKey "CompanyName" "${PUBLISHER}"
VIAddVersionKey "FileDescription" "${APP_NAME} Setup"
VIAddVersionKey "FileVersion" "${APP_VERSION}"
VIAddVersionKey "ProductVersion" "${APP_VERSION}"
VIAddVersionKey "LegalCopyright" "${PUBLISHER}"

!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "x64.nsh"
!include "LogicLib.nsh"

!define MUI_ICON "${ICON}"
!define MUI_WELCOMEFINISHPAGE_BITMAP "${BMP_DIR}/welcome.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "${BMP_DIR}/welcome.bmp"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_RIGHT
!define MUI_HEADERIMAGE_BITMAP "${BMP_DIR}/header.bmp"
!define MUI_HEADERIMAGE_UNBITMAP "${BMP_DIR}/header.bmp"
!define MUI_UNICON "${ICON}"
!define MUI_ABORTWARNING

!define MUI_WELCOMEPAGE_TITLE "Install ${APP_NAME}"
!define MUI_WELCOMEPAGE_TEXT "Setup will install ${APP_NAME} ${APP_VERSION} into Program Files.$\r$\n$\r$\nYour assessment data is stored separately for each Windows user, on this computer only, and is kept if you update or uninstall.$\r$\n$\r$\nTo run scans from the app, install Nmap (with Npcap) from nmap.org.$\r$\n$\r$\nClick Next to continue."
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_TITLE "${APP_NAME} is installed"
!define MUI_FINISHPAGE_TEXT "A CyberDome launcher was added to your Downloads folder, the Start menu and the desktop.$\r$\n$\r$\nThe program itself is installed in $INSTDIR."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchAsUser
!define MUI_FINISHPAGE_RUN_TEXT "Launch CyberDome"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "CyberDome needs 64-bit Windows."
    Abort
  ${EndIf}
  SetRegView 64
  SetShellVarContext all
FunctionEnd

Function un.onInit
  SetRegView 64
  SetShellVarContext all
FunctionEnd

; Start the app as the signed-in user, not with the installer's administrator rights.
Function LaunchAsUser
  Exec '"$WINDIR\explorer.exe" "$INSTDIR\${APP_EXE}"'
FunctionEnd

; Earlier test builds installed per user under %LOCALAPPDATA%\Programs. Remove that copy.
Function RemovePerUserCopy
  ReadRegStr $1 HKCU "${UNINST_KEY}" "InstallLocation"
  ${If} $1 != ""
  ${AndIf} ${FileExists} "$1\Uninstall CyberDome.exe"
    ExecWait '"$1\Uninstall CyberDome.exe" /S _?=$1'
    Delete "$1\Uninstall CyberDome.exe"
    RMDir /r "$1"
  ${EndIf}
  DeleteRegKey HKCU "${UNINST_KEY}"
  SetShellVarContext current
  Delete "$DESKTOP\${APP_SHORT}.lnk"
  Delete "$SMPROGRAMS\${APP_SHORT}.lnk"
  SetShellVarContext all
FunctionEnd

; The signed-in user's Downloads folder (it may be redirected, for example to OneDrive).
Function GetDownloadsDir
  ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders" "{374DE290-123F-4565-9164-39C4925E467B}"
  ${If} $R0 == ""
    ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders" "{374DE290-123F-4565-9164-39C4925E467B}"
  ${EndIf}
  ExpandEnvStrings $R0 $R0
  ${If} $R0 == ""
  ${OrIfNot} ${FileExists} "$R0\*.*"
    StrCpy $R0 "$PROFILE\Downloads"
  ${EndIf}
FunctionEnd

Section "Install"
  ; Close a running copy so its files can be replaced.
  nsExec::Exec 'taskkill /F /IM ${APP_EXE}'
  Pop $0
  Sleep 800
  Call RemovePerUserCopy

  SetOutPath "$INSTDIR"
  ; Remove files from an older version before copying the new ones.
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\locales"
  File /r "${SRC_DIR}\*.*"

  WriteUninstaller "$INSTDIR\Uninstall CyberDome.exe"

  CreateShortcut "$SMPROGRAMS\${APP_SHORT}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0 SW_SHOWNORMAL "" "${APP_NAME}"
  CreateShortcut "$DESKTOP\${APP_SHORT}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0 SW_SHOWNORMAL "" "${APP_NAME}"

  ; Launcher in the user's Downloads folder; the program itself stays in $INSTDIR.
  Call GetDownloadsDir
  ${If} ${FileExists} "$R0\*.*"
    CreateShortcut "$R0\${APP_SHORT}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0 SW_SHOWNORMAL "" "${APP_NAME}"
    WriteRegStr HKLM "${UNINST_KEY}" "DownloadsLauncher" "$R0\${APP_SHORT}.lnk"
  ${EndIf}

  WriteRegStr HKLM "${UNINST_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKLM "${UNINST_KEY}" "Publisher" "${PUBLISHER}"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\${APP_EXE},0"
  WriteRegStr HKLM "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall CyberDome.exe"'
  WriteRegStr HKLM "${UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall CyberDome.exe" /S'
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKLM "${UNINST_KEY}" "EstimatedSize" "$0"

  ; In-app updates run "CyberDomeInstaller.exe /S /RELAUNCH": reopen CyberDome afterwards,
  ; as the signed-in user rather than with the installer's administrator rights.
  ${GetParameters} $R1
  ClearErrors
  ${GetOptions} $R1 "/RELAUNCH" $R2
  ${IfNot} ${Errors}
    Exec '"$WINDIR\explorer.exe" "$INSTDIR\${APP_EXE}"'
  ${EndIf}
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /F /IM ${APP_EXE}'
  Pop $0
  Sleep 800

  Delete "$SMPROGRAMS\${APP_SHORT}.lnk"
  Delete "$DESKTOP\${APP_SHORT}.lnk"
  ReadRegStr $1 HKLM "${UNINST_KEY}" "DownloadsLauncher"
  ${If} $1 != ""
    Delete "$1"
  ${EndIf}
  RMDir /r "$INSTDIR"
  DeleteRegKey HKLM "${UNINST_KEY}"
  ; Start with Windows entry, if the user turned it on from the tray menu.
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "CyberDome.CommandCenter"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.CyberDome"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "CyberDome"

  IfSilent +2
  MessageBox MB_OK|MB_ICONINFORMATION "${APP_NAME} was removed.$\r$\n$\r$\nEach user's assessment data was kept in their own folder:$\r$\n%LOCALAPPDATA%\CyberDome\data$\r$\n$\r$\nDelete that folder yourself if you no longer need it."
SectionEnd
