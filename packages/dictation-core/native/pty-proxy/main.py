#!/usr/bin/env python3
import argparse
import fcntl
import os
import pty
import select
import struct
import subprocess
import sys
import termios


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="cli2voice PTY proxy")
    parser.add_argument("--cwd", default=os.getcwd())
    parser.add_argument("--cols", type=int, default=80)
    parser.add_argument("--rows", type=int, default=24)
    parser.add_argument("argv", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if args.argv and args.argv[0] == "--":
        args.argv = args.argv[1:]
    if not args.argv:
        parser.error("missing command to execute")
    return args


def set_window_size(fd: int, cols: int, rows: int) -> None:
    winsize = struct.pack("HHHH", rows, cols, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)


def set_nonblocking(fd: int) -> None:
    flags = fcntl.fcntl(fd, fcntl.F_GETFL)
    fcntl.fcntl(fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)


def main() -> int:
    args = parse_args()
    master_fd, slave_fd = pty.openpty()
    set_nonblocking(master_fd)

    try:
        set_window_size(slave_fd, args.cols, args.rows)
        child = subprocess.Popen(
            args.argv,
            cwd=args.cwd,
            env=os.environ.copy(),
            stdin=slave_fd,
            stdout=slave_fd,
            stderr=slave_fd,
            close_fds=True
        )
    finally:
        os.close(slave_fd)

    stdin_fd = sys.stdin.fileno()
    stdout_fd = sys.stdout.fileno()
    stdin_open = True

    while True:
        read_fds = [master_fd]
        if stdin_open:
            read_fds.append(stdin_fd)

        ready, _, _ = select.select(read_fds, [], [], 0.05)

        if master_fd in ready:
            try:
                output = os.read(master_fd, 4096)
            except BlockingIOError:
                output = b""
            except OSError:
                output = b""

            if output:
                os.write(stdout_fd, output)
            elif child.poll() is not None:
                break

        if stdin_open and stdin_fd in ready:
            try:
                incoming = os.read(stdin_fd, 4096)
            except OSError:
                incoming = b""

            if incoming:
                os.write(master_fd, incoming)
            else:
                stdin_open = False

        if child.poll() is not None:
            try:
                trailing = os.read(master_fd, 4096)
            except BlockingIOError:
                trailing = b""
            except OSError:
                trailing = b""

            if trailing:
                os.write(stdout_fd, trailing)
                continue
            break

    os.close(master_fd)
    return child.wait()


if __name__ == "__main__":
    raise SystemExit(main())
