# myRadar — Remote Control
# Evita que el PC hiberne o se apague mientras la sesión está activa.

# Bloquear hibernación y suspensión via Windows API
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class PowerMgmt {
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint SetThreadExecutionState(uint esFlags);
    public const uint ES_CONTINUOUS      = 0x80000000;
    public const uint ES_SYSTEM_REQUIRED = 0x00000001;
}
"@

# Activar: el sistema no podrá hibernar mientras este proceso esté vivo
[PowerMgmt]::SetThreadExecutionState(
    [PowerMgmt]::ES_CONTINUOUS -bor [PowerMgmt]::ES_SYSTEM_REQUIRED
) | Out-Null

Write-Host ""
Write-Host "  ✓ Hibernacion/suspension bloqueada mientras esta ventana este abierta." -ForegroundColor Green
Write-Host "  ✓ Cerrando esta ventana se restaura el comportamiento normal." -ForegroundColor Green
Write-Host ""

# Ir al proyecto y arrancar Remote Control
Set-Location "C:\Users\nabil\myRadar"
& "C:\Users\nabil\AppData\Roaming\npm\claude.cmd" remote-control

# Al salir de claude, restaurar estado de energía normal
[PowerMgmt]::SetThreadExecutionState([PowerMgmt]::ES_CONTINUOUS) | Out-Null
Write-Host ""
Write-Host "  Sesion terminada. Comportamiento de energia restaurado." -ForegroundColor Yellow
