# Lector: Beautiful Markdown Preview

A typography-first Markdown preview for VS Code, with **first-class Mermaid rendering** and the warm reading experience of the [Lector](https://lector.dockerbop.fr) app.

## Features

- Beautiful Literata serif typography for body text
- Crisp Mermaid diagram rendering with fullscreen + zoom/pan
- Syntax-highlighted code blocks with copy button
- Adapts to your VS Code light/dark theme
- Live reload as you edit

## Usage

Right-click any `.md` file in the explorer → **Open with Lector**, or run **Lector: Open Preview to the Side** from the command palette.

## Development

```bash
npm install
cd webview && npm install && cd ..
npm run build
```

Then press `F5` in VS Code to launch an Extension Development Host.

## Packaging

```bash
npm run package
```

Produces a `.vsix` you can install with `code --install-extension lector-preview-0.1.0.vsix`.
