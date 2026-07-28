param(
    [string]$PythonPath = "python.exe",
    [string]$ScriptPath = (Join-Path $PSScriptRoot "reminder_sync.py"),
    [string]$TaskName = "ReminderSyncEmail",
    [string]$Time = "20:00"
)

$Action = New-ScheduledTaskAction -Execute $PythonPath -Argument "`"$ScriptPath`"" -WorkingDirectory (Split-Path $ScriptPath)
$Trigger = New-ScheduledTaskTrigger -Daily -At $Time
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings `
    -Description "毎晩 $Time ごろに未完了のiCloudリマインダーをGmailへ送信する" -Force

Write-Host "タスク '$TaskName' を毎日 $Time に実行するよう登録しました。"
Write-Host "確認:  Get-ScheduledTask -TaskName '$TaskName' | Get-ScheduledTaskInfo"
Write-Host "手動実行: Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "削除:  Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"
