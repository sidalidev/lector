import * as vscode from 'vscode';
import * as path from 'path';

export class LectorEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const webview = webviewPanel.webview;
    const webviewRoot = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview');

    // Allow loading the bundled webview, plus images referenced from the file's
    // own folder and anywhere in the open workspace.
    const roots: vscode.Uri[] = [webviewRoot, vscode.Uri.file(path.dirname(document.uri.fsPath))];
    for (const folder of vscode.workspace.workspaceFolders ?? []) roots.push(folder.uri);

    webview.options = {
      enableScripts: true,
      localResourceRoots: roots,
    };

    webview.html = this.getHtml(webview, webviewRoot);

    const post = (type: string, payload: Record<string, unknown> = {}) => {
      webview.postMessage({ type, ...payload });
    };

    // Content the webview currently holds. Used to break the edit feedback loop:
    // an external change is only pushed when it differs from what the webview has.
    let webviewContent: string | undefined;

    const sendDocument = () => {
      const fsPath = document.uri.fsPath;
      webviewContent = document.getText();
      post('document', {
        content: webviewContent,
        fileName: path.basename(fsPath),
        filePath: fsPath,
        dirPath: path.dirname(fsPath),
      });
    };

    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString()) return;
      // The webview already reflects this content (it originated the edit).
      if (document.getText() === webviewContent) return;
      sendDocument();
    });

    const applyWebviewEdit = async (content: string) => {
      const old = document.getText();
      if (content === old) {
        webviewContent = content;
        return;
      }
      // Mark as in-sync BEFORE applying so the change listener skips the echo.
      webviewContent = content;

      // Minimal diff: replace only the changed middle (common prefix/suffix).
      // Keeps writes small and preserves unrelated cursors/decorations.
      let start = 0;
      const minLen = Math.min(old.length, content.length);
      while (start < minLen && old.charCodeAt(start) === content.charCodeAt(start)) start++;
      let endOld = old.length;
      let endNew = content.length;
      while (
        endOld > start &&
        endNew > start &&
        old.charCodeAt(endOld - 1) === content.charCodeAt(endNew - 1)
      ) {
        endOld--;
        endNew--;
      }

      const edit = new vscode.WorkspaceEdit();
      const range = new vscode.Range(document.positionAt(start), document.positionAt(endOld));
      edit.replace(document.uri, range, content.slice(start, endNew));
      await vscode.workspace.applyEdit(edit);
    };

    const messageSub = webview.onDidReceiveMessage(async (msg) => {
      if (!msg || typeof msg.type !== 'string') return;
      switch (msg.type) {
        case 'ready':
          sendDocument();
          return;
        case 'edit':
          if (typeof msg.content === 'string') await applyWebviewEdit(msg.content);
          return;
        case 'resolveUri':
          if (typeof msg.path === 'string') {
            post('resolvedUri', {
              path: msg.path,
              uri: this.resolveResourceUri(webview, document, msg.path),
            });
          }
          return;
      }
    });

    webviewPanel.onDidDispose(() => {
      changeSub.dispose();
      messageSub.dispose();
    });
  }

  private resolveResourceUri(
    webview: vscode.Webview,
    document: vscode.TextDocument,
    p: string
  ): string | null {
    try {
      const clean = p.replace(/[?#].*$/, '');
      const target = path.isAbsolute(clean)
        ? vscode.Uri.file(clean)
        : vscode.Uri.file(path.resolve(path.dirname(document.uri.fsPath), clean));
      return webview.asWebviewUri(target).toString();
    } catch {
      return null;
    }
  }

  private getHtml(webview: vscode.Webview, webviewRoot: vscode.Uri): string {
    const indexPath = vscode.Uri.joinPath(webviewRoot, 'index.html');
    let html: string;
    try {
      html = require('fs').readFileSync(indexPath.fsPath, 'utf8');
    } catch {
      return this.fallbackHtml('Webview build not found. Run `npm run build` in the extension directory.');
    }

    const nonce = this.makeNonce();
    const cspSource = webview.cspSource;

    // Rewrite asset URLs (Vite emits ./assets/...) to webview URIs
    html = html.replace(/(src|href)="\.?\/?(assets\/[^"]+)"/g, (_m, attr, p) => {
      const uri = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, p));
      return `${attr}="${uri}"`;
    });

    // Inject CSP + nonce on every script tag
    html = html.replace(/<script /g, `<script nonce="${nonce}" `);

    const csp = [
      `default-src 'none'`,
      `img-src ${cspSource} https: data: blob:`,
      `style-src ${cspSource} 'unsafe-inline'`,
      `font-src ${cspSource} data:`,
      // cspSource is required so the entry module's imported chunks
      // (CodeMirror, Mermaid…) are allowed — module imports don't inherit nonces.
      `script-src ${cspSource} 'nonce-${nonce}' 'unsafe-eval'`,
      // The webview only reaches the extension host via postMessage — no direct
      // network egress needed, so no `https:` here (blocks exfil if a render bug slips through).
      `connect-src ${cspSource}`,
    ].join('; ');

    const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
    html = html.replace('<head>', `<head>\n  ${cspMeta}`);

    return html;
  }

  private fallbackHtml(message: string): string {
    return `<!doctype html><html><body style="font-family:sans-serif;padding:24px;color:#888"><p>${message}</p></body></html>`;
  }

  private makeNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let s = '';
    for (let i = 0; i < 32; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
    return s;
  }
}
