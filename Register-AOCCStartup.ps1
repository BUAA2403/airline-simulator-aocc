param([switch]$Remove)
$ErrorActionPreference = 'Stop'
$taskName = 'Airline Simulator AOCC'
$launcher = Join-Path $PSScriptRoot 'Start-AOCC.ps1'
$taskArgs = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $launcher + '"'
$existingTask = Get-ScheduledTask -TaskPath '\' | Where-Object { $_.Actions.Arguments -contains $taskArgs } | Select-Object -First 1
if ($existingTask) { $taskName = $existingTask.TaskName }
if ($Remove) { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false; Write-Host 'AOCC startup task removed.'; exit 0 }
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $taskArgs -WorkingDirectory $PSScriptRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User ([Security.Principal.WindowsIdentity]::GetCurrent().Name)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description 'Local read-only Airline Simulator operational data sync' | Out-Null
Write-Host 'AOCC will start in the background after Windows sign-in.'
