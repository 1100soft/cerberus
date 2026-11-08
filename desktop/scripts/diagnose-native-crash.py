"""Run the Linux desktop under GDB and retain private native crash backtraces.
Reuses Vite or owns its startup/cleanup. No core/environment dumps.
"""
import argparse
from contextlib import contextmanager, nullcontext
from datetime import datetime, timezone
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request



def frontend_ready():
    try:
        with urllib.request.urlopen('http://localhost:3000', timeout=2) as response:
            html = response.read(100_000).decode(errors='replace')
        with urllib.request.urlopen('http://localhost:3000/@vite/client', timeout=2) as response:
            return '<title>GitCerberus</title>' in html and response.status == 200
    except OSError:
        return False


def frontend_port_occupied():
    for host in ('127.0.0.1', '::1'):
        try:
            with socket.create_connection((host, 3000), timeout=1):
                return True
        except OSError:
            pass
    return False


@contextmanager
def managed_frontend(desktop, directory):
    if frontend_ready():
        print('Reusing the existing Cerberus Vite server on port 3000.', flush=True)
        yield
        return
    if frontend_port_occupied():
        raise RuntimeError('Port 3000 is occupied but is not serving Cerberus. No second server was started')
    log = directory / f'vite-{os.getpid()}.log'
    fd = os.open(log, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as output:
        server = subprocess.Popen(['npm', 'run', 'dev', '--', '--host', '127.0.0.1'], cwd=desktop, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            deadline = time.monotonic() + 20
            while not frontend_ready():
                if server.poll() is not None or time.monotonic() >= deadline:
                    raise RuntimeError(f'Cerberus Vite server did not become ready. See {log}')
                time.sleep(0.1)
            print('Cerberus Vite server is ready on port 3000 (owned by this diagnostic session).', flush=True)
            yield
        finally:
            # Only this exact, separately created process group belongs to us.
            if server.poll() is None:
                try:
                    os.killpg(server.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                try:
                    server.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    try:
                        os.killpg(server.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    server.wait()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', type=Path, help='Use an already built executable')
    parser.add_argument('--log-dir', type=Path)
    parser.add_argument('--no-frontend', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if not sys.platform.startswith('linux'):
        parser.error('This diagnostic launcher is for Linux')
    debugger = shutil.which('gdb')
    if not debugger:
        parser.error('GDB is required. Install it with your distribution package manager')
    desktop = Path(__file__).resolve().parents[1]
    binary = args.binary.resolve() if args.binary else desktop / 'src-tauri/target/debug/gitcerberus'
    state = Path(os.environ.get('XDG_STATE_HOME', Path.home() / '.local/state'))
    directory = args.log_dir or state / 'gitcerberus/native-crashes'
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    log = directory / f'native-{stamp}-{os.getpid()}.log'
    # Exclude arguments/locals: these may contain account tokens or email content.
    commands = '''set pagination off
set confirm off
set debuginfod enabled off
set auto-load off
set print frame-arguments none
set print entry-values no
set breakpoint pending on
handle SIGPIPE nostop noprint pass
handle SIGUSR1 nostop noprint pass
handle SIGUSR2 nostop noprint pass
break __stack_chk_fail
python
native_stop = None
def remember_native_stop(event):
    global native_stop
    if isinstance(event, gdb.SignalEvent):
        native_stop = event.stop_signal
    elif isinstance(event, gdb.BreakpointEvent):
        native_stop = "stack-canary"
gdb.events.stop.connect(remember_native_stop)
end
run
python
if native_stop in ("stack-canary", "SIGABRT", "SIGSEGV", "SIGBUS", "SIGILL", "SIGFPE"):
    gdb.write("Native stop: " + native_stop + "\\n")
    gdb.write("CERBERUS_NATIVE_CRASH_CAPTURED\\n")
    gdb.execute("bt 64")
    gdb.execute("thread apply all bt 32")
    gdb.execute("info sharedlibrary")
elif gdb.selected_thread() is not None:
    gdb.write("CERBERUS_NATIVE_DIAGNOSTIC_INTERRUPTED\\n")
else:
    gdb.write("CERBERUS_NATIVE_NORMAL_EXIT\\n")
end
quit
'''
    with nullcontext() if args.no_frontend else managed_frontend(desktop, directory):
        if args.binary is None:
            subprocess.run(['cargo', 'build', '--manifest-path', str(desktop / 'src-tauri/Cargo.toml')], check=True)
        if not binary.is_file():
            parser.error(f'Executable not found: {binary}')
        print(f'Native diagnostic log: {log}', flush=True)
        print('Use Cerberus normally. A fatal native error will stop this diagnostic session.', flush=True)
        with tempfile.TemporaryDirectory(prefix='cerberus-gdb-') as temporary:
            script = Path(temporary) / 'capture.gdb'
            script.write_text(commands)
            fd = os.open(log, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, 'w') as output:
                output.write(f'GitCerberus native diagnostic, UTC {stamp}\n')
                output.flush()
                result = subprocess.run([debugger, '-nx', '-q', '-batch', '-x', str(script), '--args', str(binary)], cwd=desktop / 'src-tauri', stdout=output, stderr=subprocess.STDOUT)
    crashed = 'CERBERUS_NATIVE_CRASH_CAPTURED' in log.read_text(errors='replace')
    print(f'{"Native failure captured" if crashed else "Diagnostic session ended"}: {log}', flush=True)
    return 1 if crashed else result.returncode


if __name__ == '__main__':
    sys.exit(main())
