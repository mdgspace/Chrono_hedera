# Agent Guidelines & Development Environment

## Environment & Tooling

### GitHub CLI (`gh`)
- **Status:** Installed and fully authenticated (`gh auth login` is configured).
- **Executable Path:** `C:\Program Files\GitHub CLI\gh.exe`
- **Invocation in PowerShell:**
  - Direct execution: `& "C:\Program Files\GitHub CLI\gh.exe" <command>`
  - Or prepend to session PATH:
    ```powershell
    $env:Path = "C:\Program Files\GitHub CLI;" + $env:Path
    gh <command>
    ```
- **Usage:** Use `gh` for viewing/creating issues, inspecting pull requests, managing repository metadata, and checking PR diffs.

### Action Logging & Context Persistence
- **Action Log:** `action_log.md` is the workspace's single source of truth for tracking turns and past operations.
- **Workflow (`logger` skill):**
  1. **Pre-task:** Always read the last 2-3 entries of `action_log.md` before executing tasks.
  2. **Post-task:** Always append execution results to `action_log.md` with timestamp, action description, status, and key outcomes.

### Project Structure
- **Smart Contracts (`contracts/`):** Solidity `^0.8.24` developed with Hardhat.
- **Hedera Integration:** Interacts with Hedera Schedule Service (HSS / HIP-1215), HTS, and Hedera EVM (Chain ID 296).
- **Frontend (`chrono-web/`):** React + Vite + Tailwind CSS + wagmi/viem/RainbowKit.
- **Tasks & Roadmap:** Documented in `docs/todo.md`.
- **Architectural Research:** In-depth research and mathematical derivations reside in `docs/analysis/`.
