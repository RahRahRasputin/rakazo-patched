import { describe, expect, it } from "vitest";
import {
  PRIVATE_FOLDER_REFUSAL,
  privateFolderRefusal,
  shellPrivateFolderRefusal,
} from "./computer-support.js";

describe("privateFolderRefusal", () => {
  it("lets a resident use their own room and refuses everyone else's", () => {
    expect(privateFolderRefusal("dedicated", "bot-1", "PrivateFolder/note.md")).toBeUndefined();
    expect(
      privateFolderRefusal("team", "bot-1", "bots/bot-1/PrivateFolder/note.md"),
    ).toBeUndefined();
    expect(
      privateFolderRefusal("team", "bot-1", "bots/bot-1/notes/PrivateFolder/note.md"),
    ).toBeUndefined();
    expect(privateFolderRefusal("team", "bot-1", "notes/today.md")).toBeUndefined();
    expect(privateFolderRefusal("team", "bot-1", "bots/bot-2/PrivateFolder/note.md")).toBe(
      PRIVATE_FOLDER_REFUSAL,
    );
    expect(privateFolderRefusal("team", "bot-1", "shared/PrivateFolder/note.md")).toBe(
      PRIVATE_FOLDER_REFUSAL,
    );
    expect(privateFolderRefusal("team", "bot-1", "PrivateFolder/note.md")).toBe(
      PRIVATE_FOLDER_REFUSAL,
    );
  });

  it("allows a relative shell name and refuses another resident's folder", () => {
    expect(
      shellPrivateFolderRefusal("team", "bot-1", "cat PrivateFolder/note.md", "bots/bot-1"),
    ).toBeUndefined();
    expect(
      shellPrivateFolderRefusal("team", "bot-1", "cat bots/bot-1/PrivateFolder/note.md"),
    ).toBeUndefined();
    expect(shellPrivateFolderRefusal("team", "bot-1", "cat bots/bot-2/result.md")).toBeUndefined();
    expect(shellPrivateFolderRefusal("team", "bot-1", "cat bots/bot-2/PrivateFolder/note.md")).toBe(
      PRIVATE_FOLDER_REFUSAL,
    );
    expect(shellPrivateFolderRefusal("team", "bot-1", "cat shared/PrivateFolder/note.md")).toBe(
      PRIVATE_FOLDER_REFUSAL,
    );
    expect(shellPrivateFolderRefusal("team", "bot-1", "ls", "bots/bot-2/PrivateFolder")).toBe(
      PRIVATE_FOLDER_REFUSAL,
    );
  });
});
