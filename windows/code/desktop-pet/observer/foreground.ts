/**
 * 前台活动探测：一次调用问一次「现在前台是什么窗口」。
 *
 * 为什么是「按需 spawn 一个 PowerShell」而不是常驻进程：
 *   * 活动状态不会秒级变化，20~30 秒一次的采样已经足够
 *   * 没有长期子进程要管理，桌宠退出时不会留下孤儿
 *   * 单次查询约 300ms，CPU 开销可忽略
 *
 * 踩过的坑（已在本文件内修掉）：
 *   * powershell.exe 默认按系统代码页（GBK）输出，Node 按 UTF-8 解码会让中文标题变乱码
 *     —— 必须在脚本开头设置 [Console]::OutputEncoding
 *   * 窗口最大化时常带负偏移（如 -7,-7），不能逐边与屏幕比较，要用交叠面积比判全屏
 */
import { execFile } from 'node:child_process';
import type { ForegroundSample } from './classify.js';

const PROBE_SCRIPT = `
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class PetFgProbe {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex);
}
'@
$h = [PetFgProbe]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 512
[void][PetFgProbe]::GetWindowTextW($h, $sb, 512)
[uint32]$procId = 0
[void][PetFgProbe]::GetWindowThreadProcessId($h, [ref]$procId)
$p = Get-Process -Id $procId -ErrorAction SilentlyContinue
$lii = New-Object PetFgProbe+LASTINPUTINFO
$lii.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($lii)
[void][PetFgProbe]::GetLastInputInfo([ref]$lii)
$idleMs = [Environment]::TickCount - $lii.dwTime
if ($idleMs -lt 0) { $idleMs = 0 }
$r = New-Object PetFgProbe+RECT
[void][PetFgProbe]::GetWindowRect($h, [ref]$r)
$sw = [PetFgProbe]::GetSystemMetrics(0); $sh = [PetFgProbe]::GetSystemMetrics(1)
$ix = [Math]::Max(0, [Math]::Min($r.Right, $sw) - [Math]::Max($r.Left, 0))
$iy = [Math]::Max(0, [Math]::Min($r.Bottom, $sh) - [Math]::Max($r.Top, 0))
$cover = if ($sw * $sh -gt 0) { ($ix * $iy) / ($sw * $sh) } else { 0 }
[pscustomobject]@{
  title = $sb.ToString()
  process = if ($p) { $p.ProcessName } else { '' }
  idleMs = [int]$idleMs
  coverRatio = [Math]::Round($cover, 4)
  screenWidth = $sw
  screenHeight = $sh
} | ConvertTo-Json -Compress
`;

export interface ForegroundProbeOptions {
  readonly timeoutMs?: number;
  readonly executable?: string;
  /** 全屏判定的覆盖面积阈值。 */
  readonly fullscreenRatio?: number;
}

interface RawProbe {
  title?: unknown;
  process?: unknown;
  idleMs?: unknown;
  coverRatio?: unknown;
}

/**
 * 读一次前台窗口。失败时 resolve 为 null —— 桌宠不能因为看不见用户在做什么就崩掉。
 */
export function probeForeground(options: ForegroundProbeOptions = {}): Promise<ForegroundSample | null> {
  if (process.platform !== 'win32') return Promise.resolve(null);
  const timeout = options.timeoutMs ?? 8000;
  const executable = options.executable ?? 'powershell.exe';
  const threshold = options.fullscreenRatio ?? 0.92;
  return new Promise(resolve => {
    execFile(executable, ['-NoProfile', '-NonInteractive', '-Command', PROBE_SCRIPT],
      { encoding: 'utf8', windowsHide: true, timeout, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) { resolve(null); return; }
        resolve(parseProbe(stdout, threshold));
      });
  });
}

export function parseProbe(stdout: string, fullscreenRatio = 0.92): ForegroundSample | null {
  const line = stdout.trim();
  if (!line) return null;
  let raw: RawProbe;
  try { raw = JSON.parse(line) as RawProbe; } catch { return null; }
  const idleMs = typeof raw.idleMs === 'number' && Number.isFinite(raw.idleMs) ? Math.max(0, Math.round(raw.idleMs)) : 0;
  const cover = typeof raw.coverRatio === 'number' && Number.isFinite(raw.coverRatio) ? raw.coverRatio : 0;
  return {
    title: typeof raw.title === 'string' ? raw.title : '',
    process: typeof raw.process === 'string' ? raw.process : '',
    idleMs,
    fullscreen: cover >= fullscreenRatio,
    at: new Date().toISOString(),
  };
}
