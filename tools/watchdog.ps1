$log = "C:\Users\Pc Zone\AppData\Local\Temp\opencode\watchdog.log"
function Log($m) {
  try { Add-Content -Path $log -Value ((Get-Date -Format "yyyy-MM-dd HH:mm:ss") + " | " + $m) } catch {}
}
Log "watchdog started"
$hrDir = "C:\Users\Pc Zone\Desktop\hr"
$cfExe = Join-Path $hrDir "cloudflared.exe"
$cfLog = "C:\Users\Pc Zone\AppData\Local\Temp\opencode\cf.log"
$cfUrlFile = "C:\Users\Pc Zone\AppData\Local\Temp\opencode\cf.url"

while ($true) {
  try {
    # 1) Local server on 5173
    $conn = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue
    if (-not $conn) {
      Log "server down - restarting"
      Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory $hrDir -WindowStyle Hidden
      Start-Sleep 6
    }
    # 2) Cloudflare quick tunnel running
    $cf = Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath -eq $cfExe -and $_.CommandLine -match 'tunnel --url' }
    if (-not $cf) {
      Log "cloudflared down - restarting"
      $p = Start-Process -FilePath $cfExe -ArgumentList "tunnel","--url","http://localhost:5173","--protocol","http2" -WindowStyle Hidden -RedirectStandardOutput $cfLog -RedirectStandardError ($cfLog + ".err")
      Start-Sleep 12
      # extract the trycloudflare URL into a known file
      $url = $null
      try { $lines = Get-Content $cfLog -ErrorAction Stop; $m = $lines | Select-String -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' ; if ($m) { $url = $m.Matches[0].Value } } catch {}
      if ($url) { Set-Content -Path $cfUrlFile -Value $url; Log ("cf url: " + $url) }
    }
  } catch {
    Log ("err: " + $_.Exception.Message)
  }
  Start-Sleep 15
}