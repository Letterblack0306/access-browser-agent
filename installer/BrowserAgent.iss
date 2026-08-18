[Setup]
AppName=Browser Agent
AppVersion=0.1.0
DefaultDirName={autopf}\Browser Agent
DefaultGroupName=Browser Agent
OutputDir=output
OutputBaseFilename=Browser_Agent_Setup
Compression=lzma
SolidCompression=yes
UninstallDisplayIcon={app}\Access Browser Agent.exe
DisableProgramGroupPage=yes

[Tasks]
Name: desktopicon; Description: "Create a &desktop shortcut"; GroupDescription: "Additional shortcuts:"

[Files]
Source: "..\release\win-unpacked\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion

[Icons]
Name: "{group}\Browser Agent"; Filename: "{app}\Access Browser Agent.exe"
Name: "{commondesktop}\Browser Agent"; Filename: "{app}\Access Browser Agent.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\Access Browser Agent.exe"; Description: "Launch Browser Agent"; Flags: nowait postinstall skipifsilent
