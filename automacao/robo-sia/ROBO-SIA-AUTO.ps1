# =====================================================================
#  ROBO-SIA-AUTO.ps1  -  100% automatico (sem perguntar nada)
#  Fluxo: abre importador -> empresa -> arquivo -> "Importar arquivo"
#         -> fecha avisos -> aba "Dados no arquivo" -> "Aplicar ao cadastro"
#         -> fecha avisos. Reporta cada passo.
#  RODE NA MAQUINA DA LISBOA.
# =====================================================================
$ErrorActionPreference='SilentlyContinue'

# Arquivo REAL gerado pela Metade A (Pralis). Enquanto ele nao existir, o robo
# sai sem abrir nada (agendar agora e inofensivo ate a Metade A produzir o arquivo).
$ARQUIVO = 'C:\cadastro-sia\cadastro-lisboa.txt'

# --- log para rodar sozinho: guarda tudo que o robo fez ---
$logdir = 'C:\cadastro-sia\logs'
if(-not (Test-Path $logdir)){ New-Item -ItemType Directory -Path $logdir -Force | Out-Null }
Start-Transcript -Path (Join-Path $logdir ("robo-{0}.txt" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))) -Force | Out-Null

# Baixa e valida o arquivo antes de abrir o importador. Se falhar, para aqui:
# nunca reaplica silenciosamente o cadastro do dia anterior.
$downloadScript = Join-Path $PSScriptRoot 'baixar-cadastro.ps1'
if (-not (Test-Path -LiteralPath $downloadScript)) {
  Write-Host "ERRO: nao achei o downloader: $downloadScript"
  Stop-Transcript | Out-Null
  exit 1
}
& $downloadScript -Loja LI -Destino $ARQUIVO -LogDir $logdir
if ($LASTEXITCODE -ne 0) {
  Write-Host 'ERRO: download/validacao falhou; o importador nao sera aberto.'
  Stop-Transcript | Out-Null
  exit 1
}

Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern bool EnumWindows(P cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h, P cb, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern IntPtr SendMessage(IntPtr h,int m,IntPtr w,string l);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern IntPtr SendMessage(IntPtr h,int m,IntPtr w,StringBuilder l);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h,int m,IntPtr w,IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr SetFocus(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool f);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  public delegate bool P(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
  public static IntPtr main=IntPtr.Zero; static int pid;
  static List<IntPtr> acc=new List<IntPtr>(); static string flt; static string ftxt;
  public static string Cls(IntPtr h){ var s=new StringBuilder(256); GetClassName(h,s,256); return s.ToString(); }
  public static string Txt(IntPtr h){ int n=GetWindowTextLength(h)+2; var s=new StringBuilder(n); GetWindowText(h,s,n); return s.ToString(); }
  public static void FindMain(int p){ pid=p; main=IntPtr.Zero;
    EnumWindows((h,l)=>{ int q; GetWindowThreadProcessId(h,out q); if(q==pid && Cls(h)=="TfMain"){ main=h; return false; } return true; }, IntPtr.Zero); }
  public static IntPtr FirstChild(IntPtr root,string c){ flt=c; acc.Clear();
    EnumChildWindows(root,(h,l)=>{ if(Cls(h)==flt && !acc.Contains(h)) acc.Add(h); return true; }, IntPtr.Zero);
    return acc.Count>0?acc[0]:IntPtr.Zero; }
  // botao (TcxButton ou TButton) cujo texto (sem &) casa com um dos termos, no root dado
  public static IntPtr FindButton(IntPtr root,string termos){ ftxt=termos; acc.Clear();
    EnumChildWindows(root,(h,l)=>{ string c=Cls(h); if(c.IndexOf("Button")>=0){ string t=Txt(h).Replace("&","");
        foreach(var termo in ftxt.Split('|')){ if(t.Equals(termo,StringComparison.OrdinalIgnoreCase)){ acc.Add(h); break; } } } return true; }, IntPtr.Zero);
    return acc.Count>0?acc[0]:IntPtr.Zero; }
  // janelas de dialogo: top-level do processo, visiveis, != main
  public static List<IntPtr> Dialogs(){ var r=new List<IntPtr>();
    EnumWindows((h,l)=>{ int q; GetWindowThreadProcessId(h,out q);
      if(q==pid && h!=main && IsWindowVisible(h)){ int len=GetWindowTextLength(h); if(len>0) r.Add(h); } return true; }, IntPtr.Zero);
    return r; }
  public static void SetText(IntPtr h,string t){ SendMessage(h,0x000C,IntPtr.Zero,t); }
  public static string GetText(IntPtr h){ var s=new StringBuilder(512); SendMessage(h,0x000D,(IntPtr)512,s); return s.ToString(); }
  public static void Click(IntPtr h){ RECT r; GetWindowRect(h,out r); int cx=(r.R-r.L)/2, cy=(r.B-r.T)/2;
    IntPtr lp=(IntPtr)((cy<<16)|(cx&0xFFFF)); PostMessage(h,0x0201,(IntPtr)1,lp); PostMessage(h,0x0202,IntPtr.Zero,lp); }
  public static void HardFocus(IntPtr w,IntPtr ctl){ uint t=GetWindowThreadProcessId(w,IntPtr.Zero); uint me=GetCurrentThreadId();
    AttachThreadInput(me,t,true); SetForegroundWindow(w); if(ctl!=IntPtr.Zero) SetFocus(ctl); AttachThreadInput(me,t,false); }
  public static void Key(IntPtr h,int vk){ PostMessage(h,0x0100,(IntPtr)vk,IntPtr.Zero); PostMessage(h,0x0101,(IntPtr)vk,IntPtr.Zero); }
}
"@

function Fechar-Avisos([string]$prefere){
  # tenta por ~6s fechar qualquer dialogo que aparecer, clicando Sim/OK
  for($i=0;$i -lt 12;$i++){
    $dlgs=[W]::Dialogs()
    if($dlgs.Count -eq 0){ Start-Sleep -Milliseconds 500; continue }
    foreach($d in $dlgs){
      $titulo=[W]::Txt($d)
      $b=[W]::FindButton($d,$prefere)
      if($b -eq [IntPtr]::Zero){ $b=[W]::FindButton($d,'Sim|OK|Yes') }
      if($b -ne [IntPtr]::Zero){ Write-Host "    aviso '$titulo' -> clico '$([W]::Txt($b))'"; [W]::HardFocus($d,$b); Start-Sleep -Milliseconds 200; [W]::Click($b) }
      else { Write-Host "    aviso '$titulo' -> Enter"; [W]::HardFocus($d,[IntPtr]::Zero); [W]::Key($d,0x0D) }
    }
    Start-Sleep -Milliseconds 700
  }
}

$exe='C:\Program Files (x86)\Criare\ImportadorPadariaLisboa.exe'
if(-not (Test-Path $exe)){ foreach($b in @('C:\','D:\')){ $exe=Get-ChildItem $b -Recurse -Filter 'ImportadorPadaria*.exe' -EA 0 | Select-Object -First 1 -Expand FullName; if($exe){break} } }
Write-Host "Importador: $exe"
if(-not (Test-Path $ARQUIVO)){ Write-Host "  ARQUIVO nao existe: $ARQUIVO  (crie e rode de novo)"; return }
$p=Start-Process -FilePath $exe -PassThru
Start-Sleep -Seconds 6
[W]::FindMain($p.Id)
if([W]::main -eq [IntPtr]::Zero){ Write-Host 'Nao achei a janela.'; return }

Write-Host '1) empresa...'
$combo=[W]::FirstChild([W]::main,'TcxCustomComboBoxInnerEdit')
[W]::HardFocus([W]::main,$combo); Start-Sleep -Milliseconds 500
[W]::Key($combo,0x73); Start-Sleep -Milliseconds 800
[W]::Key($combo,0x28); Start-Sleep -Milliseconds 400
[W]::Key($combo,0x0D); Start-Sleep -Milliseconds 500
Write-Host ("   empresa: "+[W]::GetText($combo))

Write-Host '2) arquivo...'
$campo=[W]::FirstChild([W]::main,'TcxCustomInnerTextEdit')
[W]::SetText($campo,$ARQUIVO); Start-Sleep -Milliseconds 400
Write-Host ("   arquivo: "+[W]::GetText($campo))

Write-Host '3) clicando "Importar arquivo"...'
$bImp=[W]::FindButton([W]::main,'Importar arquivo')
[W]::HardFocus([W]::main,[IntPtr]::Zero); Start-Sleep -Milliseconds 300; [W]::Click($bImp)
Start-Sleep -Seconds 2
Fechar-Avisos 'OK'

Write-Host '4) indo para a aba "Dados no arquivo" e clicando "Aplicar ao cadastro"...'
[W]::HardFocus([W]::main,[IntPtr]::Zero); Start-Sleep -Milliseconds 300
# Ctrl+Tab para trocar de aba (a janela ja esta em foco)
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('^{TAB}')
Start-Sleep -Milliseconds 800
$bApl=[W]::FindButton([W]::main,'Aplicar ao cadastro')
if($bApl -eq [IntPtr]::Zero){ Write-Host '   nao achei "Aplicar ao cadastro" (aba pode nao ter trocado).' }
else { [W]::HardFocus([W]::main,[IntPtr]::Zero); Start-Sleep -Milliseconds 300; [W]::Click($bApl); Start-Sleep -Seconds 2; Fechar-Avisos 'Sim' }

Write-Host ''
Write-Host '==================================================================='
Write-Host '  Fluxo automatico concluido. Confirme no log do Criare as linhas'
Write-Host '  AplicarNoCadastro() ... ATUALIZADO. Log do importador:'
Write-Host '     C:\Program Files (x86)\Criare\logs\'
Write-Host '  Manda um print da tela e o log mais recente.'
Write-Host '==================================================================='
Stop-Transcript | Out-Null

