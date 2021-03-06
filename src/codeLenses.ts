import { AbsoluteTourStop, BrokenTourStop, isNotBroken } from "tourist-core";
import * as vscode from "vscode";

import * as config from "./config";
import * as globals from "./globals";
import * as util from "./util";

/**
 * Provides CodeLenses for each tourstop in the active tour
 */
class TouristCodeLensProvider implements vscode.CodeLensProvider {
  // tslint:disable-next-line: variable-name
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  // tslint:disable-next-line: member-ordering
  public readonly onDidChangeCodeLenses: vscode.Event<void> = this
    ._onDidChangeCodeLenses.event;

  public provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.CodeLens[]> {
    if (!config.useCodeLens()) {
      return [];
    }

    const lenses = [] as vscode.CodeLens[];
    if (globals.tourState) {
      globals.tourState.tour.stops.forEach(
        (stop: AbsoluteTourStop | BrokenTourStop) => {
          if (isNotBroken(stop)) {
            if (util.pathsEqual(document.fileName, stop.absPath)) {
              const position = new vscode.Position(stop.line - 1, 0);
              lenses.push(
                new vscode.CodeLens(new vscode.Range(position, position), {
                  arguments: [stop],
                  command: "tourist.gotoTourstop",
                  title: stop.title,
                }),
              );
            }
          }
        },
      );
    }

    return lenses;
  }

  public resolveCodeLens(
    codeLens: vscode.CodeLens,
    token: vscode.CancellationToken,
  ): vscode.CodeLens {
    return codeLens;
  }

  public refresh() {
    this._onDidChangeCodeLenses.fire();
  }
}

export const provider = new TouristCodeLensProvider();
