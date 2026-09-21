# Strata shell integration for PowerShell.
# Minimal two-line prompt with OSC 133 command marks and OSC 7 cwd reporting.
$env:STRATA_SHELL = "1"
$env:GIT_OPTIONAL_LOCKS = "0"
$global:__strataEsc = [char]27

function global:__strata_git {
    try {
        $b = git --no-optional-locks rev-parse --abbrev-ref HEAD 2>$null
        if ($LASTEXITCODE -eq 0 -and $b) { return $b }
    } catch {}
    return $null
}

function global:prompt {
    $ok = $?
    $code = if ($ok) { 0 } else { if ($LASTEXITCODE) { $LASTEXITCODE } else { 1 } }
    $e = $global:__strataEsc
    $cwd = (Get-Location).ProviderPath
    $uri = "file://localhost/" + ($cwd -replace '\\', '/')
    $disp = $cwd
    if ($HOME -and $cwd.StartsWith($HOME, [System.StringComparison]::OrdinalIgnoreCase)) { $disp = "~" + $cwd.Substring($HOME.Length) }
    $git = __strata_git
    $gitPart = if ($git) { " $e[38;2;107;112;128m$git$e[0m" } else { "" }
    $caret = if ($ok) { "$e[38;2;122;162;247m❯$e[0m" } else { "$e[38;2;240;113;120m❯$e[0m" }
    # D = previous command finished; OSC 7 = cwd; A = prompt start; B = prompt end (input starts)
    return "$e]133;D;$code$e\$e]7;$uri$e\$e]133;A$e\`n$e[38;2;162;167;179m$disp$e[0m$gitPart`n$caret $e]133;B$e\"
}

if (Get-Module -ListAvailable PSReadLine) {
    Import-Module PSReadLine -ErrorAction SilentlyContinue
    Set-PSReadLineOption -PredictionSource History -ErrorAction SilentlyContinue
    Set-PSReadLineOption -PredictionViewStyle InlineView -ErrorAction SilentlyContinue
    Set-PSReadLineOption -Colors @{ InlinePrediction = "`e[38;2;107;112;128m" } -ErrorAction SilentlyContinue
    Set-PSReadLineKeyHandler -Key Enter -ScriptBlock {
        [Console]::Write("$([char]27)]133;C$([char]27)\")
        [Microsoft.PowerShell.PSConsoleReadLine]::AcceptLine()
    }
}

Clear-Host
