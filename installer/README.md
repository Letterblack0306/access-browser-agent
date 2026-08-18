# Browser Agent Inno Setup Installer

## Purpose

This folder contains the Windows installer definition for Access Browser Agent.

## Requirements

- Windows
- Inno Setup 6
- Built application output available before installer compilation

## Build

```powershell
ISCC.exe installer\BrowserAgent.iss
```

## Validation

1. Compile installer.
2. Confirm generated setup EXE exists.
3. Install on clean test location.
4. Launch application.
5. Record LoopTool runtime evidence.

## Packaging Notes

The application entry point is currently defined by package.json and uses the Electron runtime.
The installer script must be updated if executable output paths change.
