import * as vscode from "vscode";
import {
  AbsoluteTourStop,
  BrokenTourStop,
  isNotBroken,
  TourFile,
  TouristError,
} from "tourist";

import * as config from "./config";
import { showDecorations, showTourList, processTourFile } from "./extension";
import { TouristWebview } from "./webview";
import { Globals } from "./globals";
import { Util } from "./util";
import {
  getTourFileURI,
  quickPickTourstop,
  quickPickTourFile,
} from "./userInput";

/**
 * Exports a function corresponding to every VSCode command we contribute.
 */
export module Commands {
  const commands = {
    "tourist.addBreakpoints": addBreakpoints,
    "tourist.addTourstop": addTourStop,
    "tourist.deleteTourstop": deleteTourStop,
    "tourist.editBody": editBody,
    "tourist.editTitle": editTitle,
    "tourist.gotoTourstop": gotoTourStop,
    "tourist.mapRepo": mapRepo,
    "tourist.moveTourstop": moveTourstop,
    "tourist.moveTourstopDown": moveTourstopDown,
    "tourist.moveTourstopUp": moveTourstopUp,
    "tourist.newTour": newTour,
    "tourist.nextTourstop": nextTourStop,
    "tourist.prevTourstop": prevTourStop,
    "tourist.refreshTour": refreshTour,
    "tourist.renameTour": renameTour,
    "tourist.startTour": startTour,
    "tourist.stopTour": stopTour,
  };

  // TODO: it'd be best to not keep this here. Could stick it in Extension or
  //       Globals, but I'm not crazy about that either.
  let context: vscode.ExtensionContext | undefined;

  /**
   * Registers each command with the `vscode` API, called on activation.
   */
  export function registerAll(ctx: vscode.ExtensionContext) {
    context = ctx;

    for (const [cmdName, cmdFn] of Object.entries(commands)) {
      vscode.commands.registerCommand(cmdName, cmdFn);
    }
  }

  /**
   * Goes to the next tourstop in the active editor
   */
  export async function nextTourStop() {
    if (!Globals.tourState) return;

    const next = Globals.tourState.nextTourStop();
    if (next) {
      await gotoTourStop(next);
    } else {
      vscode.window.showInformationMessage("No more tourstops!");
    }
  }

  /**
   * Goes to the previous tourstop in the active editor
   */
  export async function prevTourStop() {
    if (!Globals.tourState) return;

    const prev = Globals.tourState.prevTourStop();
    if (prev) {
      await gotoTourStop(prev);
    } else {
      vscode.window.showInformationMessage("No more tourstops!");
    }
  }

  /**
   * Adds a new TourStop to the current Tour
   */
  export async function addTourStop() {
    const editor = vscode.window.activeTextEditor;
    if (!Globals.tourState || !editor) return;

    const title =
      (await vscode.window.showInputBox({ prompt: "Stop title:" })) || "";
    try {
      await Globals.tourist.add(Globals.tourState.tourFile, {
        title,
        absPath: editor.document.fileName,
        line: editor.selection.active.line + 1,
      });
    } catch (error) {
      switch (error.code) {
        case 200: // Repo not mapped to path
          // TODO: The repo name should be attached to the error
          await mapRepo();
          break;
        case 201: // Path not mapped to repo
          // TODO: This could be better...
          await mapRepo();
          break;
        case 203: // Mismatched repo versions
          showError(error);
          break;
        case 100: // Invalid file
        case 101: // Invalid line number
        case 202: // Could not get current repo version
        default:
          showError(error, false);
          break;
      }
      console.error(error);
    }
    await processTourFile(Globals.tourState.tourFile, Globals.tourState.path);
  }

  /**
   * Goes to the given tourstop in the active editor
   */
  export async function gotoTourStop(stop?: AbsoluteTourStop | BrokenTourStop) {
    if (!Globals.tourState) return;
    if (stop === undefined) stop = await quickPickTourstop();

    if (stop && isNotBroken(stop)) {
      Globals.tourState.currentStop = stop;

      // In the TreeView, select the new tourstop
      if (Globals.treeView && Globals.treeView.visible) {
        // TODO: do not use `as any`, you heathen
        (Globals.treeView as any).reveal(stop);
      }

      const file = vscode.Uri.file(stop.absPath);
      vscode.workspace.openTextDocument(file).then(
        (doc) => {
          vscode.window
            .showTextDocument(doc, vscode.ViewColumn.One)
            .then((editor) => {
              if (stop && isNotBroken(stop)) {
                const pos = new vscode.Position(stop.line - 1, 0);
                editor.selection = new vscode.Selection(pos, pos);
                editor.revealRange(
                  editor.selection,
                  config.tourstopRevealLocation(),
                );
                if (Globals.tourState) {
                  showDecorations(Globals.tourState.tour);
                }
              }
            })
            .then(() => {
              if (Globals.tourState) {
                TouristWebview.setTourStop(Globals.tourState.tour, stop!);
              }
            });
        },
        (error: any) => {
          console.error(error);
          vscode.window.showErrorMessage(`Unable to open ${file.fsPath}`);
        },
      );
    }
  }

  /**
   * Delete TourStop from current Tour
   */
  export async function deleteTourStop(
    stop?: AbsoluteTourStop | BrokenTourStop,
  ) {
    if (!Globals.tourState) return;
    if (stop === undefined) stop = await quickPickTourstop();

    if (stop) {
      const idx = Globals.tourState.tour.stops.indexOf(stop);
      if (idx !== -1) {
        try {
          await Globals.tourist.remove(Globals.tourState.tourFile, idx);
        } catch (error) {
          switch (error.code) {
            case 0:
            default:
              showError(error, false);
              break;
          }
          console.error(error);
        }
        await processTourFile(
          Globals.tourState.tourFile,
          Globals.tourState.path,
        );
      }
    }
  }

  /**
   * Edits the title of a TourStop in the current Tour
   */
  export async function editTitle(
    stop?: AbsoluteTourStop | BrokenTourStop,
  ): Promise<void> {
    if (!Globals.tourState) return;
    if (stop === undefined) stop = await quickPickTourstop();

    if (stop) {
      const title = await vscode.window.showInputBox();
      if (title !== undefined) {
        const idx = Globals.tourState.tour.stops.indexOf(stop);
        if (idx !== -1) {
          try {
            await Globals.tourist.edit(Globals.tourState.tourFile, idx, {
              title,
            });
          } catch (error) {
            switch (error.code) {
              case 0:
              default:
                showError(error, false);
                break;
            }
          }
          await processTourFile(
            Globals.tourState.tourFile,
            Globals.tourState.path,
          );
          TouristWebview.setTourStop(
            Globals.tourState.tour,
            Globals.tourState.tour.stops[idx],
          );
        }
      }
    }
  }

  /**
   * Edits the body of a TourStop in the current Tour
   */
  export async function editBody(
    stop?: AbsoluteTourStop | BrokenTourStop,
    body?: string,
  ): Promise<void> {
    if (!Globals.tourState) return;
    if (stop === undefined) stop = await quickPickTourstop();

    if (stop) {
      if (body === undefined) {
        body = await vscode.window.showInputBox();
      }

      if (body !== undefined) {
        const idx = Globals.tourState.tour.stops.indexOf(stop);
        if (idx !== -1) {
          try {
            await Globals.tourist.edit(Globals.tourState.tourFile, idx, {
              body: body,
            });
          } catch (error) {
            switch (error.code) {
              case 0:
              default:
                showError(error, false);
                break;
            }
          }
          await processTourFile(
            Globals.tourState.tourFile,
            Globals.tourState.path,
          );
          TouristWebview.setTourStop(
            Globals.tourState.tour,
            Globals.tourState.tour.stops[idx],
          );
        }
      }
    }
  }

  /**
   * Swaps the given tourstop with the one above it
   */
  export async function moveTourstopUp(
    stop?: AbsoluteTourStop | BrokenTourStop,
  ) {
    if (!Globals.tourState) return;
    if (stop === undefined) stop = await quickPickTourstop();

    if (stop) {
      const idx = Globals.tourState.tour.stops.indexOf(stop);
      if (idx > 0) {
        const otherIdx = idx - 1;
        const newIndices = Array.from(
          Array(Globals.tourState.tour.stops.length).keys(),
        ).map((i) => {
          if (i === idx) {
            return otherIdx;
          } else if (i === otherIdx) {
            return idx;
          } else {
            return i;
          }
        });
        try {
          await Globals.tourist.scramble(
            Globals.tourState.tourFile,
            newIndices,
          );
        } catch (error) {
          switch (error.code) {
            case 1:
            default:
              showError(error, false);
              break;
          }
        }
      }

      await processTourFile(Globals.tourState.tourFile, Globals.tourState.path);
    }
  }

  /**
   * Swaps the given tourstop with the one below it
   */
  export async function moveTourstopDown(
    stop?: AbsoluteTourStop | BrokenTourStop,
  ) {
    if (!Globals.tourState) return;
    if (stop === undefined) stop = await quickPickTourstop();

    if (stop) {
      const idx = Globals.tourState.tour.stops.indexOf(stop);
      if (idx < Globals.tourState.tour.stops.length && idx !== -1) {
        const otherIdx = idx + 1;
        const newIndices = Array.from(
          Array(Globals.tourState.tour.stops.length).keys(),
        ).map((i) => {
          if (i === idx) {
            return otherIdx;
          } else if (i === otherIdx) {
            return idx;
          } else {
            return i;
          }
        });
        try {
          await Globals.tourist.scramble(
            Globals.tourState.tourFile,
            newIndices,
          );
        } catch (error) {
          switch (error.code) {
            case 1:
            default:
              showError(error, false);
              break;
          }
        }
      }

      await processTourFile(Globals.tourState.tourFile, Globals.tourState.path);
    }
  }

  /**
   * Changes a TourStop's location
   */
  // TODO: this should probably be renamed, since it has nothing to do with moveTourstopUp/Down
  export async function moveTourstop(stop?: AbsoluteTourStop | BrokenTourStop) {
    if (!Globals.tourState) return;
    if (stop === undefined) stop = await quickPickTourstop();

    if (stop) {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        try {
          await Globals.tourist.move(
            Globals.tourState.tourFile,
            Globals.tourState.tour.stops.indexOf(stop),
            {
              absPath: editor.document.fileName,
              line: editor.selection.active.line + 1,
            },
          );
        } catch (error) {
          switch (error.code) {
            case 200: // Repo not mapped to path
              // TODO: The repo name should be attached to the error
              await mapRepo();
              break;
            case 201: // Path not mapped to repo
              // TODO: This could be better...
              await mapRepo();
              break;
            case 203: // Mismatched repo versions
              showError(error);
              break;
            case 100: // Invalid file
            case 101: // Invalid line number
            case 202: // Could not get current repo version
            default:
              showError(error, false);
              break;
          }
          console.error(error);
        }
        await processTourFile(
          Globals.tourState.tourFile,
          Globals.tourState.path,
        );
      }
    }
  }

  /**
   * Starts a Tour from a .tour file
   */
  export async function startTour(uri?: vscode.Uri): Promise<void> {
    if (uri === undefined) {
      uri = await getTourFileURI();
    }

    if (uri) {
      const tf = await Util.parseTourFile(uri.fsPath);
      await processTourFile(tf, uri.fsPath);
      if (Globals.tourState) {
        gotoTourStop(Globals.tourState.tour.stops[0]);
      }
    }
  }

  /**
   * Stops the current tour, showing the list of tours in the TreeView
   */
  export async function stopTour(): Promise<void> {
    showTourList();
    TouristWebview.close();
  }

  /**
   * Update the tourstop locations in a TourFile to reflect the current version
   */
  export async function refreshTour(tf?: TourFile): Promise<void> {
    // TODO: so this doesn't work when you're not in a tour (which is the common case)
    if (!Globals.tourState) return;
    if (!tf) tf = await quickPickTourFile();
    if (!tf) return;

    try {
      await Globals.tourist.refresh(tf);
      await processTourFile(tf, Globals.tourState.path);
    } catch (error) {
      switch (error.code) {
        case 200: // Repo not mapped to path
          // TODO: The repo name should be attached to the error
          await mapRepo();
        case 300: // No repo version
        default:
          showError(error, false);
          break;
      }
      vscode.window.showErrorMessage(`Error code ${error.code} thrown`);
    }
  }

  /**
   * Changes the title of the tour
   */
  export async function renameTour(
    tf?: TourFile,
    name?: string,
  ): Promise<void> {
    // TODO: so this doesn't work when you're not in a tour (which is the common case)
    if (!Globals.tourState) return;
    if (!tf) tf = await quickPickTourFile();
    if (!tf) return;
    if (name === undefined) name = await vscode.window.showInputBox();
    if (name === undefined) return;

    try {
      await Globals.tourist.rename(tf, name);
      await processTourFile(tf, Globals.tourState.path);
    } catch (error) {
      switch (error.code) {
        case 200: // Repo not mapped to path
          // TODO: The repo name should be attached to the error
          await mapRepo();
        case 300: // No repo version
        default:
          showError(error, false);
          break;
      }
      vscode.window.showErrorMessage(error);
    }
  }

  /**
   * Maps a name used in the .tour file to a repository path on disk
   */
  export async function mapRepo(repoName?: string): Promise<void> {
    if (!repoName) {
      repoName = await vscode.window.showInputBox({
        prompt: "What's the name of the repository?",
      });
    }

    if (repoName) {
      const path = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
      });
      if (path) {
        await Globals.tourist.mapConfig(repoName, path[0].fsPath);
        context!.globalState.update(
          "touristInstance",
          Globals.tourist.serialize(),
        );
      }
    }
  }

  /**
   * Creates a new Tour, saving the .tour file to disk
   */
  //TODO: accept fully qualified path as an argument
  export async function newTour(): Promise<void> {
    const folderName = vscode.workspace.rootPath
      ? vscode.workspace.rootPath.split(new RegExp(/\\|\//)).pop()
      : "My Tour";
    const title = await vscode.window.showInputBox({
      value: folderName,
      prompt: "Tour name:",
    });
    // TODO: preferably let them pick a save location
    // TODO: this is pretty brittle...
    const path =
      (vscode.workspace.workspaceFolders
        ? vscode.workspace.workspaceFolders[0].uri.fsPath
        : "") +
      "/" +
      title +
      ".tour";
    if (title !== undefined) {
      const tf = await Globals.tourist.init(title);
      await processTourFile(tf, path);
    }
  }

  /**
   * Places a breakpoint at each tourstop location in the active tour
   */
  export async function addBreakpoints(): Promise<void> {
    if (!Globals.tourState) return;

    const breakpoints = [] as vscode.SourceBreakpoint[];
    for (const stop of Globals.tourState.tour.stops) {
      if (isNotBroken(stop)) {
        breakpoints.push(
          new vscode.SourceBreakpoint(
            new vscode.Location(
              vscode.Uri.file(stop.absPath),
              new vscode.Position(stop.line - 1, 0),
            ),
          ),
        );
      }
    }

    vscode.debug.addBreakpoints(breakpoints);
  }
}

function showError(error: TouristError, expected = true) {
  if (expected) {
    console.warn(error.message);
  } else {
    console.error(
      `Hit an unexpected error. code: ${error.code}, message: ${error.message}`,
    );
  }
  vscode.window.showErrorMessage(error.message);
}