!include "LogicLib.nsh"
!define HEXGATE_STOP_SCRIPT "${__FILEDIR__}\stop-installed.ps1"

!macro HEXGATE_STOP_INSTALLED_PROCESSES
  InitPluginsDir
  File /oname=$PLUGINSDIR\hexgate-stop.ps1 "${HEXGATE_STOP_SCRIPT}"
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\hexgate-stop.ps1" -InstallDir "$INSTDIR"'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONSTOP "Impossible de fermer Hexgate. Quittez Hexgate depuis son icone pres de l'horloge, puis relancez l'installation."
    Abort
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro HEXGATE_STOP_INSTALLED_PROCESSES
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro HEXGATE_STOP_INSTALLED_PROCESSES
!macroend
