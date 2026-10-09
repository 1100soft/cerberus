#!/usr/bin/env python3
import hashlib
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('assets', Path(__file__).with_name('prepare-release-assets.py'))
assets = importlib.util.module_from_spec(spec)
spec.loader.exec_module(assets)


class ReleaseTests(unittest.TestCase):
    def test_platform_names_and_checksums(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name in ('mac-arm', 'mac-intel'):
                folder = root / 'inputs' / name
                folder.mkdir(parents=True)
                (folder / 'same.dmg').write_bytes(name.encode())
            prepared = assets.prepare(root / 'inputs', root / 'outputs')
            self.assertEqual(len(prepared), 2)
            self.assertEqual(len({path.name for path in prepared}), 2)
            sums = (root / 'outputs' / 'SHA256SUMS').read_text()
            for path in prepared:
                self.assertIn(f'{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n', sums)
            with self.assertRaises(ValueError):
                assets.prepare(root / 'inputs', root / 'outputs')

    def test_reject_empty_unexpected_and_duplicate_artifacts(self):
        for kind in ('empty', 'unexpected', 'duplicate'):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                folder = root / 'inputs' / 'linux'
                folder.mkdir(parents=True)
                if kind == 'unexpected':
                    (folder / 'unexpected.txt').write_text('unexpected')
                elif kind == 'duplicate':
                    for nested in ('a', 'b'):
                        (folder / nested).mkdir()
                        (folder / nested / 'same.deb').write_text(nested)
                with self.assertRaises(ValueError):
                    assets.prepare(root / 'inputs', root / 'outputs')

    def draft(self, mode):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'release-assets').mkdir()
            (root / 'release-assets' / 'linux.deb').write_text('installer')
            (root / 'release-assets' / 'SHA256SUMS').write_text('checksum')
            fake = root / 'gh'
            fake.write_text('''#!/usr/bin/env python3
import os,sys,json
from pathlib import Path
with open('calls','a') as log:log.write(json.dumps(sys.argv[1:])+'\\n')
if sys.argv[1]=='api':
 mode=os.environ['TEST_MODE']
 if mode=='api-error':sys.exit(1)
 if '/git/ref/' in sys.argv[2]:
  print(('tag\\t'+'c'*40) if mode=='annotated' else 'commit\\t'+('b' if mode=='moved-tag' else 'a')*40);sys.exit(0)
 if '/git/tags/' in sys.argv[2]:print('commit\\t'+'a'*40);sys.exit(0)
 if mode=='published':print('false\\t'+'a'*40)
 if mode=='wrong-sha':print('true\\t'+'b'*40)
 if mode=='draft':print('true\\t'+'a'*40)
''')
            fake.chmod(0o755)
            result = subprocess.run(['bash', str(ROOT / '.github/scripts/draft-release.sh')], cwd=root,
                                    env={**os.environ, 'PATH': f'{root}:{os.environ["PATH"]}',
                                         'RELEASE_TAG': 'v0.1.0', 'RELEASE_SHA': 'a' * 40,
                                         'GITHUB_REPOSITORY': 'example/app', 'TEST_MODE': mode},
                                    capture_output=True, text=True)
            return result, (root / 'calls').read_text()

    def test_draft_retry_and_publication_protection(self):
        result, calls = self.draft('new')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('"create"', calls)
        self.assertIn('"--draft"', calls)
        self.assertIn('"--verify-tag"', calls)
        self.assertNotIn('"edit"', calls)
        result, calls = self.draft('draft')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn('"create"', calls)
        self.assertIn('"upload"', calls)
        result, calls = self.draft('annotated')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('/git/tags/', calls)
        for mode in ('published', 'wrong-sha', 'api-error', 'moved-tag'):
            result, calls = self.draft(mode)
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn('"upload"', calls)
            self.assertNotIn('"create"', calls)


if __name__ == '__main__':
    unittest.main()
