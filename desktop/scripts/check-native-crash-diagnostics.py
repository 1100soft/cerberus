"""Verify crash capture on sacrificial C fixtures; never start the desktop app."""
import os
import importlib.util
from unittest.mock import Mock, patch
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

if not sys.platform.startswith('linux') or not shutil.which('gdb') or not shutil.which('cc'):
    print('SKIP: native crash diagnostic fixtures require Linux, GDB and a C compiler')
    sys.exit(0)

launcher = Path(__file__).with_name('diagnose-native-crash.py')
spec = importlib.util.spec_from_file_location('cerberus_native_diagnostics', launcher)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with tempfile.TemporaryDirectory(prefix='cerberus-frontend-check-') as temporary:
    root = Path(temporary)
    with patch.object(module, 'frontend_ready', return_value=True), patch.object(module.subprocess, 'Popen') as spawn:
        with module.managed_frontend(root, root):
            pass
        spawn.assert_not_called()
    with patch.object(module, 'frontend_ready', return_value=False), patch.object(module, 'frontend_port_occupied', return_value=True), patch.object(module.subprocess, 'Popen') as spawn:
        try:
            with module.managed_frontend(root, root):
                raise AssertionError('Occupied port was accepted')
        except RuntimeError:
            pass
        spawn.assert_not_called()
    owned = root / 'owned'
    owned.mkdir()
    process = Mock(pid=123456)
    process.poll.return_value = None
    with patch.object(module, 'frontend_ready', side_effect=[False, True]), patch.object(module, 'frontend_port_occupied', return_value=False), patch.object(module.subprocess, 'Popen', return_value=process) as spawn, patch.object(module.os, 'killpg') as stop:
        with module.managed_frontend(root, owned):
            stop.assert_not_called()
        assert spawn.call_args.kwargs['start_new_session'] is True
        stop.assert_called_once_with(process.pid, module.signal.SIGTERM)
        process.wait.assert_called_once()
    failed = root / 'failed'
    failed.mkdir()
    process.reset_mock()
    with patch.object(module, 'frontend_ready', return_value=False), patch.object(module, 'frontend_port_occupied', return_value=False), patch.object(module.subprocess, 'Popen', return_value=process), patch.object(module.os, 'killpg') as stop, patch.object(module.time, 'monotonic', side_effect=[0, 21]):
        try:
            with module.managed_frontend(root, failed):
                raise AssertionError('Unready server was accepted')
        except RuntimeError:
            pass
        stop.assert_called_once_with(process.pid, module.signal.SIGTERM)
    # --binary skips a build, but must still establish a working frontend.
    context = Mock()
    context.__enter__ = Mock()
    context.__exit__ = Mock(return_value=False)
    with patch.object(module.sys, 'argv', [str(launcher), '--binary', '/usr/bin/true', '--log-dir', str(root / 'direct')]), patch.object(module, 'managed_frontend', return_value=context) as frontend, patch.object(module.subprocess, 'run', return_value=Mock(returncode=0)):
        assert module.main() == 0
        frontend.assert_called_once()
print('Frontend readiness, existing-server reuse, port collision refusal and owned-server cleanup checks passed')
with tempfile.TemporaryDirectory(prefix='cerberus-crash-check-') as temporary:
    root = Path(temporary)
    cases = {
        'stack': ('extern void __stack_chk_fail(void); void fault(const char *value) { __stack_chk_fail(); } int main(void) { fault("fixture-private-token-value"); }', True),
        'abort': ('#include <stdlib.h>\nint main(void) { abort(); }', True),
        'normal': ('int main(void) { return 0; }', False),
    }
    for name, (source, failure) in cases.items():
        code = root / f'{name}.c'
        code.write_text(source)
        binary = root / name
        subprocess.run(['cc', '-g', '-O0', str(code), '-o', str(binary)], check=True)
        logs = root / f'{name}-logs'
        result = subprocess.run([sys.executable, str(launcher), '--no-frontend', '--binary', str(binary), '--log-dir', str(logs)], capture_output=True, text=True, timeout=20)
        assert result.returncode == int(failure), result.stdout + result.stderr
        log = next(logs.glob('native-*.log'))
        text = log.read_text()
        assert ('CERBERUS_NATIVE_CRASH_CAPTURED' in text) == failure, text
        if failure:
            assert 'main (' in text and 'Shared Object Library' in text, text
        assert 'fixture-private-token-value' not in text, 'Backtrace exposed frame arguments'
        assert log.stat().st_mode & 0o077 == 0, 'Diagnostic log is not private'
        assert logs.stat().st_mode & 0o077 == 0, 'Diagnostic folder is not private'
print('Native stack-canary/abort capture, normal exit and argument/log privacy checks passed')
