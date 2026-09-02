# Pi Repository Architecture Diagram (SDE Intern View)

## Core Packages (Workspaces)
- **Coding Agent** (packages/coding-agent)
  - Agent Core (agent/src): Framework orchestration loop (main.ts)
  - TUI Library (tui/src): UI components (VStack, HStack, ScrollView)
  - Melon Server (server/src): REST/GraphQL API + session storage
  - Protocol (protocol/src): Message serialization/RPC layer
- **AI Provider** (packages/ai): LLM models & auth system
- **Client** (packages/client): User-facing CLI applications
- **Desktop** (desktop/): Electron shell for coding agent
- **Session Backends**: SQLite (session-backends/sqlite-node) for storage

## Key Relationships
1. **Coding Agent** ←→ **TUI Library**: Renders transcript + dock layout
2. **Coding Agent** ←→ **AI Provider**: LLM inference requests
3. **Coding Agent** ←→ **Melon Server**: Session persistence
4. **TUI Library** ←→ **Protocol**: Message serialization
5. **Client** ←→ **Coding Agent**: Entry point for commands
6. **AI Provider** ←→ **Melon Server**: Authentication & model catalog

## Key Components
- **Layout System**: VStack/HStack/ScrollView (tui/src/components)
- **Alt-Screen Mode**: Constrained layout (transcript + dock)
- **Message Flow**: Client → Protocol → Server → AI → Protocol → TUI
- **State Management**: Client state ↔ Session storage

## Entry Points
- CLI: `pi` command (client/src/client.ts)
- TUI: Electron main (desktop/main.ts) / React (melon-web)
- API: Melon Server REST endpoints (server/src)