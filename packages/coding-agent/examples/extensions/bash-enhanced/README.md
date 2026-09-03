# Bash Enhanced Extension

Enhanced bash tool with improved rendering similar to pi-pretty.

## Features

- Color-coded exit status (`exit 0` vs `exit 1`)
- Collapsible output preview with line count headers
- Command truncation when collapsed
- Enhanced error display
- Working indicator integration

## Installation

```bash
pi -e ./path/to/extensions/bash-enhanced/src/index.ts
```

## Usage

Use the existing `bash` tool normally:

```text
bash command="pwd"
find pattern="*.ts" path="src"
ls path="src"
```

The extension automatically enhances all of them with:
- Colored exit status indicators
- Collapsible output headers
- Line count previews