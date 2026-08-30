# IDE Builder

Build IDE features with clear boundaries between UI, workspace access, process execution, and platform integration.

## First Establish the Architecture

1. Identify whether the product is a web editor, Electron app, Tauri app, native app, VS Code extension, JetBrains plugin, or another host.
2. Inspect the manifest, process/renderer entry points, IPC or command boundary, editor integration, workspace/file abstraction, and existing tests.
3. Map the requested feature to its owning layer before editing. Do not create a parallel file-system, terminal, or editor implementation if one already exists.
4. Confirm operating-system assumptions and supported platforms before adding platform-specific behavior.

## Safety-Critical Boundaries

- Treat the workspace root as a security boundary. Normalize and validate paths; reject traversal and access outside approved roots.
- Keep privileged file-system, shell, process, credential, and native APIs out of untrusted renderer/webview code.
- Expose narrow, typed IPC/command APIs. Validate every input at the privileged boundary and return actionable errors.
- Never construct shell commands from untrusted strings. Prefer argument arrays, controlled working directories, and cancellation/timeouts.
- Do not load remote content with elevated privileges or disable platform security controls merely to simplify development.

## Feature Workflow

1. Define the user-visible behavior and failure/cancellation cases.
2. Implement data and command ownership first, then UI state, then rendering.
3. For editor work, preserve document lifecycle details: dirty state, save/save-as, external modifications, file encoding/line endings where supported, tabs, and cleanup on close.
4. For terminal work, handle lifecycle, working-directory validation, output buffering, resize, exit status, cancellation, and resource cleanup.
5. For plugins or extensions, define capability boundaries, versioned contracts, isolation expectations, and failure containment.
6. Ensure keyboard navigation, focus management, labels, and command discoverability are considered for UI features.

## Validation

- Run the narrowest existing static, unit, and integration checks.
- Test a representative workspace end-to-end when the environment permits: open workspace, edit, save, invoke the feature, and verify error handling.
- State the exact validation level reached; a build alone does not prove IDE runtime behavior.

## Completion Checklist

- Privileged boundaries remain narrow and validated.
- Workspace access stays inside approved roots.
- Lifecycle/error/cancellation paths are addressed.
- Changed files and actual validation results are reported.