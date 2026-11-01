import * as vscode from 'vscode';
import { LectorEditorProvider } from './editorProvider';

export function activate(context: vscode.ExtensionContext) {
  const provider = new LectorEditorProvider(context);

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      'lector.markdownPreview',
      provider,
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lector.openPreview', async (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target || !/\.(md|markdown)$/i.test(target.fsPath)) {
        vscode.window.showInformationMessage('Open a Markdown file to use Lector preview.');
        return;
      }
      await vscode.commands.executeCommand('vscode.openWith', target, 'lector.markdownPreview');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lector.openToTheSide', async (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target || !/\.(md|markdown)$/i.test(target.fsPath)) {
        vscode.window.showInformationMessage('Open a Markdown file to use Lector preview.');
        return;
      }
      await vscode.commands.executeCommand(
        'vscode.openWith',
        target,
        'lector.markdownPreview',
        vscode.ViewColumn.Beside
      );
    })
  );
}

export function deactivate() {}
