"""A small, friendly Python REPL for this Replit project."""

from __future__ import annotations

import code
import pathlib
import sys
from typing import NoReturn


PROMPT = ">>> "
CONTINUATION_PROMPT = "... "


class ProjectConsole(code.InteractiveConsole):
    """Interactive console with a small set of colon commands."""

    def __init__(self) -> None:
        super().__init__()
        self.locals["__name__"] = "__console__"

    def show_help(self) -> None:
        print(
            """
Commands:
  :help              Show this help message
  :vars              List variables created in the session
  :load <file>       Run a Python file in this session
  :reset             Clear variables and restart the session namespace
  :exit              Leave the REPL

You can also use normal Python expressions, statements, imports, and
multiline blocks. Press Ctrl-D to exit.
""".strip()
        )

    def show_vars(self) -> None:
        variables = {
            name: value
            for name, value in self.locals.items()
            if not name.startswith("_") and name not in {"__console__"}
        }
        if not variables:
            print("No user variables yet.")
            return

        for name, value in sorted(variables.items()):
            print(f"{name} = {value!r}")

    def load_file(self, filename: str) -> None:
        path = pathlib.Path(filename).expanduser()
        if not path.is_file():
            print(f"File not found: {path}")
            return

        try:
            source = path.read_text(encoding="utf-8")
            self.runcode(compile(source, str(path), "exec"), self.locals)
        except (OSError, SyntaxError) as error:
            print(f"Could not load {path}: {error}")

    def reset(self) -> None:
        self.locals.clear()
        self.locals["__name__"] = "__console__"
        self.buffer.clear()
        print("Session reset.")

    def handle_command(self, line: str) -> bool:
        command, _, argument = line.partition(" ")
        command = command.lower()
        argument = argument.strip()

        if command in {":exit", ":quit", ":q"}:
            return False
        if command == ":help":
            self.show_help()
        elif command == ":vars":
            self.show_vars()
        elif command == ":load":
            if not argument:
                print("Usage: :load <file>")
            else:
                self.load_file(argument)
        elif command == ":reset":
            self.reset()
        else:
            print(f"Unknown command: {command}. Type :help for help.")
        return True


def run() -> NoReturn:
    console = ProjectConsole()
    print("Python REPL")
    print("Type :help for commands, or :exit to leave.")

    while True:
        try:
            prompt = CONTINUATION_PROMPT if console.buffer else PROMPT
            line = input(prompt)
        except EOFError:
            print()
            return
        except KeyboardInterrupt:
            console.resetbuffer()
            print("\nKeyboardInterrupt")
            continue

        if not console.buffer and line.startswith(":"):
            if not console.handle_command(line):
                return
            continue

        try:
            console.push(line)
        except SystemExit:
            return


if __name__ == "__main__":
    run()